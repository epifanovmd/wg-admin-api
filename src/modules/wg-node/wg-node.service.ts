import { inject } from "inversify";
import { type EntityManager, In } from "typeorm";

import { config } from "../../config";
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
import { ApiKeyService } from "../api-key";
import type {
  IAssignWgNodeBody,
  ICreatedWgNodeDto,
  ICreateWgNodeBody,
  IUpdateWgNodeBody,
  IWgAgentKeyDto,
} from "./dto";
import { WgNodeDto, WgNodeOptionDto } from "./dto";
import {
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
import {
  EWgNodeStatus,
  IWgNodeOsInfo,
  nodeIdFromScopes,
  wgAgentScope,
} from "./wg-node.types";

/** Состояние, которое агент сообщает о себе и ноде. */
export interface IWgAgentStateReport {
  appliedVersion?: number;
  applyError?: string | null;
  agentVersion?: string;
  wgVersion?: string | null;
  codeHash?: string | null;
  osInfo?: IWgNodeOsInfo;
}

/** Установка агента вручную: установщик с бэкенда, ключ — аргументом. */
const installCommand = (agentKey: string): string =>
  `curl -fsSL ${config.app.publicUrl}/api/v1/wg-agent/install.sh | sudo sh -s -- --key '${agentKey.replace(/'/g, "'\\''")}'`;

const mapSaveError = (err: unknown): unknown => {
  if (isUniqueViolation(err)) return WgNodeError.NAME_TAKEN();
  if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
    return WgNodeError.USER_NOT_FOUND();
  }

  return err;
};

/**
 * Ноды: CRUD с областью прав «все / свои» (владелец или создатель), ключи
 * агентов, версии конфигурации и живость агентов. Чужая нода без права на
 * все не раскрывается (404); видимая, но без права на действие — 403.
 * Методы без актора — внутренние (агент, задачи, другие модули домена).
 */
@Injectable()
export class WgNodeService {
  constructor(
    @inject(WgNodeRepository) private readonly _repo: WgNodeRepository,
    @inject(ApiKeyService) private readonly _apiKeys: ApiKeyService,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Создать ноду и выпустить ключ агента (секрет возвращается один раз). */
  async create(
    actor: AuthContext,
    body: ICreateWgNodeBody,
  ): Promise<ICreatedWgNodeDto> {
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

    try {
      const agentKey = await this._issueAgentKey(actor.userId, node);
      const dto = WgNodeDto.fromEntity(node);

      this._eventBus.emit(new WgNodeCreatedEvent(dto));

      return { node: dto, agentKey, installCommand: installCommand(agentKey) };
    } catch (err) {
      await this._repo.delete({ id: node.id });
      throw err;
    }
  }

  /** Перевыпустить ключ агента по запросу пользователя (право agent). */
  async rotateAgentKey(
    actor: AuthContext,
    id: string,
  ): Promise<IWgAgentKeyDto> {
    const node = await this.findFor(actor, id, WgNodePermissions.NODE_AGENT);

    return this.reissueAgentKey(actor.userId, node.id);
  }

  /** Перевыпустить ключ агента без проверки прав: старый отзывается сразу. */
  async reissueAgentKey(actorId: string, id: string): Promise<IWgAgentKeyDto> {
    const node = await this._findOrFail(id);

    if (node.agentKeyId) {
      await this._apiKeys.revoke(node.agentKeyId, actorId);
    }

    const agentKey = await this._issueAgentKey(actorId, node);

    return { agentKey, installCommand: installCommand(agentKey) };
  }

  async list(
    actor: AuthContext,
    filters: IWgNodeFilters,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgNodeDto>> {
    const [items, total] = await this._repo.findPage(
      { ...filters, ...this.viewFilter(actor) },
      pagination,
    );

    return toPage(items.map(WgNodeDto.fromEntity), total, pagination);
  }

  async options(actor: AuthContext): Promise<WgNodeOptionDto[]> {
    const { ownedBy } = this.viewFilter(actor);
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

    if (node.agentKeyId) {
      await this._apiKeys.revoke(node.agentKeyId, actor.userId);
    }

    this._eventBus.emit(
      new WgNodeDeletedEvent(node.id, node.ownerId, node.createdById),
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

  /** Ограничение списков нод областью просмотра; права нет — 403. */
  viewFilter(actor: AuthContext): { ownedBy?: string } {
    const filter = WgNodeAccess.filter(actor, WgNodePermissions.NODE_VIEW);

    if (!filter) throw WgNodeError.FORBIDDEN();

    return filter;
  }

  /** Нода по scopes агентского api-ключа; чужой/не агентский ключ — 403. */
  async findByAgentScopes(scopes: string[]): Promise<WgNode> {
    const nodeId = nodeIdFromScopes(scopes);
    const node = nodeId
      ? await this._repo.findOne({ where: { id: nodeId } })
      : null;

    if (!node) throw WgNodeError.AGENT_SCOPE_INVALID();

    return node;
  }

  /** Отметить активность агента; молчавшая нода возвращается в online. */
  async touchAgent(node: WgNode, remoteIp?: string): Promise<void> {
    const becameOnline = node.status !== EWgNodeStatus.Online;
    const ipChanged = !!remoteIp && remoteIp !== node.agentRemoteIp;

    node.lastSeenAt = new Date();
    node.status = EWgNodeStatus.Online;
    if (ipChanged) node.agentRemoteIp = remoteIp;
    await this._repo.update(
      { id: node.id },
      {
        lastSeenAt: node.lastSeenAt,
        status: node.status,
        ...(ipChanged ? { agentRemoteIp: remoteIp } : {}),
      },
    );

    if (becameOnline) {
      this._eventBus.emit(
        new WgNodeStatusChangedEvent(WgNodeDto.fromEntity(node)),
      );
    }
  }

  /** Принять отчёт агента о применённой конфигурации и системе. */
  async reportAgentState(
    node: WgNode,
    report: IWgAgentStateReport,
  ): Promise<void> {
    const patch: Partial<WgNode> = {
      // Версия только растёт: устаревший отчёт не откатывает прогресс.
      ...(report.appliedVersion !== undefined &&
        report.appliedVersion > node.appliedVersion && {
          appliedVersion: report.appliedVersion,
        }),
      ...(report.applyError !== undefined && { applyError: report.applyError }),
      ...(report.agentVersion !== undefined && {
        agentVersion: report.agentVersion,
      }),
      ...(report.wgVersion !== undefined && { wgVersion: report.wgVersion }),
      ...(report.codeHash !== undefined && { agentCodeHash: report.codeHash }),
      ...(report.osInfo !== undefined && { osInfo: report.osInfo }),
    };

    // Только поля отчёта: полный save сущности, загруженной в начале
    // запроса, затирал configVersion, поднятый параллельной транзакцией.
    if (Object.keys(patch).length > 0) {
      await this._repo.update({ id: node.id }, patch);
    }

    Object.assign(node, await this._findOrFail(node.id));
    this._eventBus.emit(new WgNodeUpdatedEvent(WgNodeDto.fromEntity(node)));
  }

  /** Молчащие ноды — в offline; события — по каждой изменённой. */
  async sweepSilentAgents(offlineAfterSec: number): Promise<number> {
    const silentSince = new Date(Date.now() - offlineAfterSec * 1000);

    return (await this._markOffline(silentSince)).length;
  }

  /**
   * Нода молчит с момента `silentSince` — в offline (разорвано постоянное
   * соединение агента и новое не появилось).
   */
  async markOfflineIfSilent(
    nodeId: string,
    silentSince: Date,
  ): Promise<boolean> {
    return (await this._markOffline(silentSince, nodeId)).length > 0;
  }

  private async _markOffline(
    silentSince: Date,
    nodeId?: string,
  ): Promise<string[]> {
    const ids = await this._repo.markSilentOffline(silentSince, nodeId);

    if (ids.length === 0) return ids;

    // Событие — полной нодой из БД (UPDATE … RETURNING отдаёт сырые колонки).
    for (const node of await this._repo.find({ where: { id: In(ids) } })) {
      this._eventBus.emit(
        new WgNodeStatusChangedEvent(WgNodeDto.fromEntity(node)),
      );
    }

    return ids;
  }

  async setStatus(id: string, status: EWgNodeStatus): Promise<void> {
    await this._applyStatus(await this._findOrFail(id), status);
  }

  /**
   * Агент удалён с VPS: ключ отозван, нода — снова `created` (можно
   * установить заново), версия кода агента сброшена.
   */
  async detachAgent(id: string, actorId: string): Promise<void> {
    const node = await this._findOrFail(id);

    if (node.agentKeyId) await this._apiKeys.revoke(node.agentKeyId, actorId);

    node.agentKeyId = null;
    node.agentCodeHash = null;
    await this._repo.update({ id }, { agentKeyId: null, agentCodeHash: null });
    await this._applyStatus(node, EWgNodeStatus.Created);
    this._eventBus.emit(new WgNodeUpdatedEvent(WgNodeDto.fromEntity(node)));
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

  private async _issueAgentKey(actorId: string, node: WgNode): Promise<string> {
    const created = await this._apiKeys.create(actorId, {
      name: `wg-agent:${node.name}`.slice(0, 100),
      scopes: [wgAgentScope(node.id)],
    });

    node.agentKeyId = created.apiKey.id;
    await this._repo.update({ id: node.id }, { agentKeyId: node.agentKeyId });

    return created.key;
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
    const node = await this._repo.findOne({ where: { id } });

    if (!node) throw WgNodeError.NOT_FOUND();

    return node;
  }
}
