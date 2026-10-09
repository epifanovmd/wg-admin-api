import { inject } from "inversify";
import { type EntityManager, IsNull } from "typeorm";

import type { IPaginatedDto, Pagination } from "../../core";
import {
  EventBus,
  Injectable,
  isUniqueViolation,
  PG_ERROR,
  pgErrorCode,
  toPage,
} from "../../core";
import type { AuthContext } from "../../types/koa";
import type {
  IAssignWgNodeBody,
  ICreateWgNodeBody,
  IUpdateWgNodeBody,
} from "./dto";
import { WgNodeDto, WgNodeOptionDto } from "./dto";
import {
  WgNodeAgentUnboundEvent,
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeHostChangedEvent,
  WgNodeStatusChangedEvent,
  WgNodeUpdatedEvent,
} from "./events";
import { WgNodeAccess } from "./wg-node.access";
import { WgNode } from "./wg-node.entity";
import { WgNodeError } from "./wg-node.errors";
import { WgNodePermissions } from "./wg-node.permissions";
import type { IWgNodeFilters } from "./wg-node.repository";
import { WgNodeRepository } from "./wg-node.repository";
import { EWgNodeStatus, IWgNodeOsInfo } from "./wg-node.types";

/**
 * Что известно о ноде от агента и воркеров: связь, версии, ОС, итог
 * применения конфигурации. Поля без значения не меняются.
 */
export interface IWgNodeAgentState {
  status?: EWgNodeStatus;
  statusMessage?: string | null;
  appliedVersion?: number;
  applyError?: string | null;
  agentVersion?: string | null;
  wgVersion?: string | null;
  osInfo?: IWgNodeOsInfo | null;
  agentRemoteIp?: string | null;
  lastSeenAt?: Date | null;
}

/** Поля состояния, которые сравниваются по значению (jsonb — по JSON). */
const sameValue = (a: unknown, b: unknown): boolean =>
  a instanceof Date || b instanceof Date
    ? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const mapSaveError = (err: unknown): unknown => {
  if (isUniqueViolation(err)) return WgNodeError.NAME_TAKEN();
  if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
    return WgNodeError.USER_NOT_FOUND();
  }

  return err;
};

/**
 * Ноды: CRUD с областью прав «все / свои» (владелец или создатель), версии
 * конфигурации и состояние агента. Чужая нода без права на все не
 * раскрывается (404); видимая, но без права на действие — 403. Методы без
 * актора — внутренние (агент, задачи, другие модули домена).
 */
@Injectable()
export class WgNodeService {
  constructor(
    @inject(WgNodeRepository) private readonly _repo: WgNodeRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Создать ноду; команду установки агента выдаёт `WgNodeAgentService`. */
  async create(actor: AuthContext, body: ICreateWgNodeBody): Promise<WgNode> {
    const ownerId = body.ownerId ?? null;

    if (
      ownerId !== null &&
      ownerId !== actor.userId &&
      !WgNodeAccess.scope(actor, WgNodePermissions.NODE_ASSIGN)
    ) {
      throw WgNodeError.FORBIDDEN();
    }

    let node: WgNode;

    try {
      node = await this._repo.createAndSave({
        name: body.name,
        description: body.description ?? null,
        publicHost: body.publicHost ?? null,
        ownerId,
        createdById: actor.userId,
        status: EWgNodeStatus.Created,
      });
    } catch (err) {
      throw mapSaveError(err);
    }

    const created = await this._findOrFail(node.id);

    this._eventBus.emit(new WgNodeCreatedEvent(WgNodeDto.fromEntity(created)));

    return created;
  }

  /** Ноды в рамках прав; `mine` — только свои при любой области. */
  async list(
    actor: AuthContext,
    { mine, ...filters }: IWgNodeFilters & { mine?: boolean },
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgNodeDto>> {
    const [items, total] = await this._repo.findPage(
      { ...filters, ...this.viewFilter(actor, mine) },
      pagination,
    );

    return toPage(items.map(WgNodeDto.fromEntity), total, pagination);
  }

  async options(
    actor: AuthContext,
    mine?: boolean,
  ): Promise<WgNodeOptionDto[]> {
    const { ownedBy } = this.viewFilter(actor, mine);
    const items = await this._repo.find({
      where: ownedBy ? WgNodeAccess.ownedWhere(ownedBy) : {},
      order: { name: "ASC" },
    });

    return items.map(WgNodeOptionDto.fromEntity);
  }

  async get(actor: AuthContext, id: string): Promise<WgNodeDto> {
    return WgNodeDto.fromEntity(
      await this.findFor(actor, id, WgNodePermissions.NODE_VIEW),
    );
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgNodeBody,
  ): Promise<WgNodeDto> {
    const node = await this.findFor(actor, id, WgNodePermissions.NODE_UPDATE);
    const hostChanged =
      body.publicHost !== undefined && body.publicHost !== node.publicHost;
    // Только изменённые колонки: полный save вернул бы configVersion,
    // поднятый параллельной транзакцией.
    const patch: Partial<Pick<WgNode, "name" | "description" | "publicHost">> =
      {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.publicHost !== undefined && { publicHost: body.publicHost }),
      };

    try {
      if (Object.keys(patch).length > 0) {
        await this._repo.update({ id }, patch);
      }

      const dto = WgNodeDto.fromEntity(await this._findOrFail(id));

      this._eventBus.emit(new WgNodeUpdatedEvent(dto));
      if (hostChanged) this._eventBus.emit(new WgNodeHostChangedEvent(id));

      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw WgNodeError.NAME_TAKEN();
      throw err;
    }
  }

  /** Удалить ноду; интерфейсы удаляются заранее (FK RESTRICT → 409). */
  async delete(actor: AuthContext, id: string): Promise<void> {
    const node = await this.findFor(actor, id, WgNodePermissions.NODE_DELETE);

    try {
      await this._repo.delete({ id: node.id });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgNodeError.HAS_INTERFACES();
      }
      throw err;
    }

    this._eventBus.emit(
      new WgNodeDeletedEvent(
        node.id,
        node.ownerId,
        node.createdById,
        node.agentId,
        actor.userId,
      ),
    );
  }

  /** Назначить владельца ноды. */
  async assign(
    actor: AuthContext,
    id: string,
    body: IAssignWgNodeBody,
  ): Promise<WgNodeDto> {
    const node = await this.findFor(actor, id, WgNodePermissions.NODE_ASSIGN);

    try {
      await this._repo.update({ id }, { ownerId: body.userId });
    } catch (err) {
      throw mapSaveError(err);
    }

    return this._emitOwnerChanged(node, body.userId);
  }

  /** Снять владельца ноды. */
  async revoke(actor: AuthContext, id: string): Promise<WgNodeDto> {
    const node = await this.findFor(actor, id, WgNodePermissions.NODE_ASSIGN);

    await this._repo.update({ id }, { ownerId: null });

    return this._emitOwnerChanged(node, null);
  }

  /**
   * Нода для действия актора: невидимая — 404, видимая без права на
   * действие — 403. Проверка доступа к ноде и для других модулей домена.
   */
  async findFor(
    actor: AuthContext,
    id: string,
    permission: string,
  ): Promise<WgNode> {
    const node = await this._findOrFail(id);

    if (!WgNodeAccess.can(actor, WgNodePermissions.NODE_VIEW, node)) {
      throw WgNodeError.NOT_FOUND();
    }
    if (!WgNodeAccess.can(actor, permission, node)) {
      throw WgNodeError.FORBIDDEN();
    }

    return node;
  }

  /**
   * Ограничение списков нод областью просмотра; `mine` — только свои при
   * любой области; права нет — 403.
   */
  viewFilter(actor: AuthContext, mine?: boolean): { ownedBy?: string } {
    const filter = WgNodeAccess.listFilter(
      actor,
      WgNodePermissions.NODE_VIEW,
      mine,
    );

    if (!filter) throw WgNodeError.FORBIDDEN();

    return filter;
  }

  /**
   * Состояние ноды от агента: пишутся только изменившиеся колонки (полный
   * save затёр бы `configVersion`, поднятый параллельной транзакцией);
   * `appliedVersion` только растёт. Изменилось — событие ноды.
   */
  async applyAgentState(
    nodeId: string,
    state: IWgNodeAgentState,
  ): Promise<void> {
    const node = await this._repo.findOne({ where: { id: nodeId } });

    if (!node) return;

    const patch: Partial<WgNode> = {};

    for (const [key, value] of Object.entries(state) as [
      keyof IWgNodeAgentState,
      unknown,
    ][]) {
      if (value === undefined) continue;
      if (
        key === "appliedVersion" &&
        (value as number) <= node.appliedVersion
      ) {
        continue;
      }
      if (!sameValue(node[key], value)) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    const changed = Object.keys(patch);
    const quiet =
      changed.length > 0 && changed.every(key => key === "lastSeenAt");

    if (changed.length === 0) return;

    await this._repo.update({ id: nodeId }, patch);
    // Одна отметка «последний раз на связи» не стоит события.
    if (quiet) return;

    const dto = WgNodeDto.fromEntity(await this._findOrFail(nodeId));

    this._eventBus.emit(
      patch.status !== undefined
        ? new WgNodeStatusChangedEvent(dto)
        : new WgNodeUpdatedEvent(dto),
    );
  }

  /** Ноды с агентами: id ноды и агента. */
  boundNodes(): Promise<Array<{ id: string; agentId: string }>> {
    return this._repo.findBound();
  }

  /** Нода без агента с этим именем или `null`. */
  findUnboundByName(name: string): Promise<WgNode | null> {
    return this._repo.findOne({ where: { name, agentId: IsNull() } });
  }

  /** Нода агента или `null`. */
  findByAgentId(agentId: string): Promise<WgNode | null> {
    return this._repo.findByAgentId(agentId);
  }

  /**
   * Привязать агента к ноде (прежняя привязка агента к другой ноде
   * снимается); возвращает прежнего агента ноды, если он был другим.
   */
  async bindAgent(nodeId: string, agentId: string): Promise<string | null> {
    const node = await this._findOrFail(nodeId);
    const previous = node.agentId;

    if (previous === agentId) return null;

    await this._repo.manager.transaction(async manager => {
      const repo = this._repo.getRepository(manager);

      await repo.update(
        { agentId },
        { agentId: null, status: EWgNodeStatus.Created, statusMessage: null },
      );
      await repo.update(
        { id: nodeId },
        { agentId, statusMessage: null, applyError: null },
      );
      // Новому агенту — всё состояние заново.
      await this._repo.markDirty(nodeId, manager);
    });

    this._eventBus.emit(
      new WgNodeUpdatedEvent(
        WgNodeDto.fromEntity(await this._findOrFail(nodeId)),
      ),
    );

    return previous;
  }

  /** Агент отозван или удалён: нода — без агента (`created`). */
  async unbindAgent(agentId: string): Promise<void> {
    const nodeId = await this._repo.clearAgent(agentId);

    if (!nodeId) return;

    this._eventBus.emit(new WgNodeAgentUnboundEvent(nodeId));
    this._eventBus.emit(
      new WgNodeStatusChangedEvent(
        WgNodeDto.fromEntity(await this._findOrFail(nodeId)),
      ),
    );
  }

  async setStatus(id: string, status: EWgNodeStatus): Promise<void> {
    await this._applyStatus(await this._findOrFail(id), status);
  }

  /** Установка агента провалилась: `provisioning` → `error`, иначе без изменений. */
  async failProvisioning(id: string): Promise<void> {
    const node = await this._findOrFail(id);

    if (node.status !== EWgNodeStatus.Provisioning) return;

    await this._applyStatus(node, EWgNodeStatus.Error);
  }

  /** Поднять желаемую версию конфигурации ноды (в транзакции изменения). */
  markDirty(nodeId: string, manager?: EntityManager): Promise<void> {
    return this._repo.markDirty(nodeId, manager);
  }

  markDirtyMany(nodeIds: string[], manager?: EntityManager): Promise<void> {
    return this._repo.markDirtyMany(nodeIds, manager);
  }

  async findEntity(id: string): Promise<WgNode> {
    return this._findOrFail(id);
  }

  private async _emitOwnerChanged(
    node: WgNode,
    ownerId: string | null,
  ): Promise<WgNodeDto> {
    const dto = WgNodeDto.fromEntity(await this._findOrFail(node.id));
    const previous = node.ownerId !== ownerId ? node.ownerId : null;

    this._eventBus.emit(new WgNodeUpdatedEvent(dto, previous));

    return dto;
  }

  private async _applyStatus(
    node: WgNode,
    status: EWgNodeStatus,
  ): Promise<void> {
    if (node.status === status) return;

    node.status = status;
    await this._repo.update({ id: node.id }, { status });
    this._eventBus.emit(
      new WgNodeStatusChangedEvent(WgNodeDto.fromEntity(node)),
    );
  }

  private async _findOrFail(id: string): Promise<WgNode> {
    const node = await this._repo.findWithOwners(id);

    if (!node) throw WgNodeError.NOT_FOUND();

    return node;
  }
}
