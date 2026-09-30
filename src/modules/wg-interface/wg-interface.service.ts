import { inject } from "inversify";
import { DataSource, EntityManager } from "typeorm";

import type { IPaginatedDto, Pagination } from "../../core";
import {
  EventBus,
  Injectable,
  isUniqueViolation,
  PG_ERROR,
  pgConstraint,
  pgErrorCode,
  toPage,
} from "../../core";
import type { AuthContext } from "../../types/koa";
import {
  WgEndpoint,
  WgEndpointPermissions,
  WgEndpointService,
} from "../wg-endpoint";
import {
  generateWgKeyPair,
  WgNodeCommandDto,
  WgNodeCommandService,
  WgNodePermissions,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import type {
  IAssignWgInterfaceBody,
  ICreateWgInterfaceBody,
  IUpdateWgInterfaceBody,
} from "./dto";
import { WgInterfaceDto, WgInterfaceOptionDto } from "./dto";
import { WgInterfaceCreatedEvent, WgInterfaceDeletedEvent } from "./events";
import { WgInterfaceAccess } from "./wg-interface.access";
import { WgInterface } from "./wg-interface.entity";
import { WgInterfaceError } from "./wg-interface.errors";
import { hasHooks, WgInterfaceGuard } from "./wg-interface.guard";
import {
  copyStatus,
  emitInterfaceUpdated,
  findInterfaceFor,
  findInterfaceOrFail,
  interfaceCopyNodes,
} from "./wg-interface.lookup";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import type { IWgInterfaceFilters } from "./wg-interface.repository";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { EWgInterfaceStatus } from "./wg-interface.types";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";
import { WgRelaySyncService } from "./wg-relay-sync.service";

/** Тело задаёт произвольные PostUp/PostDown. */
const touchesHooks = (
  body: Pick<ICreateWgInterfaceBody, "customPostUp" | "customPostDown">,
): boolean =>
  (body.customPostUp !== undefined && body.customPostUp !== null) ||
  (body.customPostDown !== undefined && body.customPostDown !== null);

/** Фактический статус интерфейса из отчёта агента. */
export interface IWgInterfaceStatusReport {
  name: string;
  status: EWgInterfaceStatus;
  message?: string | null;
}

/**
 * WG-интерфейсы: CRUD с областью прав «все / свои» (владелец или создатель),
 * перенос, включение/выключение, статусы от агента. Чужой интерфейс без права
 * на все не раскрывается (404); видимый без права на действие — 403. Методы
 * без актора — внутренние (агент, другие модули домена). Реплики —
 * `WgInterfaceReplicaService`, проверки размещения — `WgInterfaceGuard`.
 */
@Injectable()
export class WgInterfaceService {
  constructor(
    @inject(WgInterfaceRepository)
    private readonly _repo: WgInterfaceRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
    @inject(WgEndpointService) private readonly _endpoints: WgEndpointService,
    @inject(WgRelaySyncService) private readonly _relaySync: WgRelaySyncService,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(DataSource) private readonly _dataSource: DataSource,
    @inject(WgInterfaceGuard) private readonly _guard: WgInterfaceGuard,
    @inject(WgInterfaceReplicaService)
    private readonly _replicas: WgInterfaceReplicaService,
  ) {}

  async create(
    actor: AuthContext,
    body: ICreateWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    const ownerId = body.ownerId ?? null;

    if (
      ownerId !== null &&
      ownerId !== actor.userId &&
      !WgInterfaceAccess.scope(actor, WgInterfacePermissions.INTERFACE_ASSIGN)
    ) {
      throw WgInterfaceError.FORBIDDEN();
    }
    // Новый интерфейс — свой для создателя: хватает любой области права.
    if (
      touchesHooks(body) &&
      !WgInterfaceAccess.scope(actor, WgInterfacePermissions.INTERFACE_HOOKS)
    ) {
      throw WgInterfaceError.CUSTOM_HOOKS_FORBIDDEN();
    }
    await this._nodes.findFor(actor, body.nodeId, WgNodePermissions.NODE_VIEW);
    if (touchesHooks(body)) {
      await this._guard.assertHooksAllowedOn(actor, [body.nodeId]);
    }
    await this._guard.assertNodeFree(body.nodeId, body);

    const endpoint = await this._resolveEndpoint(
      actor,
      body.endpointId ?? null,
    );

    if (endpoint) {
      this._guard.assertRelayNotSelf(endpoint, body.nodeId);
      await this._guard.assertEndpointPortFree(
        endpoint.id,
        body.endpointPort ?? body.listenPort,
      );
    }
    await this._guard.assertRelayPortsFree({
      nodeId: body.nodeId,
      listenPort: body.listenPort,
      endpointPort: body.endpointPort ?? null,
      endpoint,
    });

    const keys = generateWgKeyPair();
    let created: WgInterface;

    try {
      created = await this._dataSource.transaction(async manager => {
        const saved = await this._repo.getRepository(manager).save({
          nodeId: body.nodeId,
          ownerId,
          createdById: actor.userId,
          name: body.name,
          listenPort: body.listenPort,
          addressCidr: body.addressCidr,
          addressV6Cidr: body.addressV6Cidr ?? null,
          privateKeyEnc: this._secrets.seal(keys.privateKey),
          publicKey: keys.publicKey,
          dns: body.dns ?? null,
          mtu: body.mtu ?? null,
          endpointId: endpoint?.id ?? null,
          endpointPort: body.endpointPort ?? null,
          natEnabled: body.natEnabled ?? true,
          customPostUp: body.customPostUp ?? null,
          customPostDown: body.customPostDown ?? null,
          enabled: body.enabled ?? true,
          status: EWgInterfaceStatus.Unknown,
          statusMessage: null,
        });

        await this._nodes.markDirty(body.nodeId, manager);

        return saved;
      });
    } catch (err) {
      throw this._mapOwnerError(err);
    }

    await this._relaySync.syncRelaySafe(endpoint?.relayNodeId);

    const dto = await this._dtoWithRelations(created.id);

    this._eventBus.emit(new WgInterfaceCreatedEvent(dto));

    return dto;
  }

  async list(
    actor: AuthContext,
    filters: IWgInterfaceFilters,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgInterfaceDto>> {
    const [items, total] = await this._repo.findPage(
      { ...filters, ...this.viewFilter(actor) },
      pagination,
    );

    return toPage(items.map(WgInterfaceDto.fromEntity), total, pagination);
  }

  async options(
    actor: AuthContext,
    nodeId?: string,
  ): Promise<WgInterfaceOptionDto[]> {
    const { ownedBy } = this.viewFilter(actor);
    const byNode = nodeId ? { nodeId } : {};
    const items = await this._repo.find({
      where: ownedBy
        ? WgInterfaceAccess.ownedWhere(ownedBy).map(owned => ({
            ...owned,
            ...byNode,
          }))
        : byNode,
      relations: { node: true },
      order: { name: "ASC" },
    });

    return items.map(WgInterfaceOptionDto.fromEntity);
  }

  async get(actor: AuthContext, id: string): Promise<WgInterfaceDto> {
    return WgInterfaceDto.fromEntity(
      await this.findFor(actor, id, WgInterfacePermissions.INTERFACE_VIEW),
    );
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_UPDATE,
    );

    if (
      touchesHooks(body) &&
      !WgInterfaceAccess.can(
        actor,
        WgInterfacePermissions.INTERFACE_HOOKS,
        iface,
      )
    ) {
      throw WgInterfaceError.CUSTOM_HOOKS_FORBIDDEN();
    }
    if (touchesHooks(body)) {
      await this._guard.assertHooksAllowedOn(actor, [
        iface.nodeId,
        ...(iface.replicas ?? []).map(replica => replica.nodeId),
      ]);
    }

    const previousRelayNodeId = iface.endpoint?.relayNodeId ?? null;
    const previousEndpointId = iface.endpointId;

    if (body.name !== undefined) iface.name = body.name;
    if (body.listenPort !== undefined) iface.listenPort = body.listenPort;
    if (body.addressCidr !== undefined) iface.addressCidr = body.addressCidr;
    if (body.addressV6Cidr !== undefined) {
      iface.addressV6Cidr = body.addressV6Cidr;
    }
    if (body.dns !== undefined) iface.dns = body.dns;
    if (body.mtu !== undefined) iface.mtu = body.mtu;
    if (body.endpointPort !== undefined) iface.endpointPort = body.endpointPort;
    if (body.natEnabled !== undefined) iface.natEnabled = body.natEnabled;
    if (body.customPostUp !== undefined) iface.customPostUp = body.customPostUp;
    if (body.customPostDown !== undefined) {
      iface.customPostDown = body.customPostDown;
    }

    let endpoint: WgEndpoint | null = iface.endpoint ?? null;

    if (body.endpointId !== undefined && body.endpointId !== iface.endpointId) {
      endpoint = await this._resolveEndpoint(actor, body.endpointId);
      iface.endpointId = endpoint?.id ?? null;
      iface.endpoint = endpoint;
    }

    if (body.activeReplicaNodeId !== undefined) {
      if (
        body.activeReplicaNodeId !== null &&
        !interfaceCopyNodes(iface).includes(body.activeReplicaNodeId)
      ) {
        throw WgInterfaceError.ACTIVE_REPLICA_INVALID();
      }
      // Закреплённая копия — единственный кандидат релея: не поднята —
      // клиенты остались бы без связи.
      if (
        body.activeReplicaNodeId !== null &&
        body.activeReplicaNodeId !== iface.activeReplicaNodeId &&
        copyStatus(iface, body.activeReplicaNodeId) !== EWgInterfaceStatus.Up
      ) {
        throw WgInterfaceError.ACTIVE_REPLICA_DOWN();
      }
      iface.activeReplicaNodeId = body.activeReplicaNodeId;
    }

    for (const nodeId of interfaceCopyNodes(iface)) {
      await this._guard.assertNodeFree(nodeId, iface);
    }

    if (endpoint) {
      if (body.endpointId !== undefined) {
        for (const nodeId of interfaceCopyNodes(iface)) {
          this._guard.assertRelayNotSelf(endpoint, nodeId);
        }
      }
      await this._guard.assertEndpointPortFree(
        endpoint.id,
        iface.endpointPort ?? iface.listenPort,
        iface.id,
      );
    }
    await this._guard.assertRelayPortsFree({
      id: iface.id,
      nodeId: iface.nodeId,
      listenPort: iface.listenPort,
      endpointPort: iface.endpointPort,
      endpoint,
    });

    try {
      await this._dataSource.transaction(async manager => {
        await this._repo
          .getRepository(manager)
          .save(this._withoutRelations(iface));
        await this._nodes.markDirtyMany(interfaceCopyNodes(iface), manager);
      });
    } catch (err) {
      throw this._mapUniqueError(err);
    }

    await this._relaySync.syncRelaySafe(previousRelayNodeId);
    await this._relaySync.syncRelaySafe(endpoint?.relayNodeId);

    return emitInterfaceUpdated(
      this._repo,
      this._eventBus,
      iface.id,
      previousEndpointId !== iface.endpointId ? previousEndpointId : null,
    );
  }

  /**
   * Перенести интерфейс на другую ноду с тем же ключом и пирами: с точкой
   * подключения клиентские конфиги не меняются. Обе ноды получают новую
   * версию, релей точки пересинхронизирует линк на новую ноду.
   */
  async move(
    actor: AuthContext,
    id: string,
    targetNodeId: string,
  ): Promise<WgInterfaceDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_MOVE,
    );
    const previousNodeId = iface.nodeId;
    const endpoint = iface.endpoint ?? null;

    if (targetNodeId === previousNodeId) {
      throw WgInterfaceError.MOVE_SAME_NODE();
    }

    await this._nodes.findFor(actor, targetNodeId, WgNodePermissions.NODE_VIEW);
    if (hasHooks(iface)) {
      await this._guard.assertHooksAllowedOn(actor, [targetNodeId]);
    }
    if (iface.replicas?.some(replica => replica.nodeId === targetNodeId)) {
      throw WgInterfaceError.MOVE_TO_REPLICA();
    }
    await this._guard.assertNodeFree(targetNodeId, iface);
    if (endpoint) this._guard.assertRelayNotSelf(endpoint, targetNodeId);
    await this._guard.assertRelayPortsFree({
      id: iface.id,
      nodeId: targetNodeId,
      listenPort: iface.listenPort,
      endpointPort: iface.endpointPort,
      endpoint,
    });

    iface.nodeId = targetNodeId;
    iface.node = undefined;
    if (iface.activeReplicaNodeId === previousNodeId) {
      iface.activeReplicaNodeId = null;
    }

    try {
      await this._dataSource.transaction(async manager => {
        await this._repo
          .getRepository(manager)
          .save(this._withoutRelations(iface));
        await this._nodes.markDirty(previousNodeId, manager);
        await this._nodes.markDirty(targetNodeId, manager);
      });
    } catch (err) {
      throw this._mapUniqueError(err);
    }

    await this._relaySync.syncRelaySafe(endpoint?.relayNodeId);

    return this._emitUpdated(iface.id);
  }

  /** Удалить интерфейс; с пирами — 409. */
  async delete(actor: AuthContext, id: string): Promise<void> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_DELETE,
    );

    try {
      await this._dataSource.transaction(async manager => {
        await this._repo.getRepository(manager).delete({ id: iface.id });
        await this._nodes.markDirtyMany(interfaceCopyNodes(iface), manager);
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgInterfaceError.HAS_PEERS();
      }
      throw err;
    }

    await this._relaySync.syncRelaySafe(iface.endpoint?.relayNodeId);
    this._eventBus.emit(
      new WgInterfaceDeletedEvent(
        iface.id,
        interfaceCopyNodes(iface),
        iface.endpointId,
        iface.ownerId,
        iface.createdById,
      ),
    );
  }

  async setEnabled(
    actor: AuthContext,
    id: string,
    enabled: boolean,
  ): Promise<WgInterfaceDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_CONTROL,
    );

    if (iface.enabled !== enabled) {
      await this._dataSource.transaction(async manager => {
        await this._repo.getRepository(manager).update({ id }, { enabled });
        await this._nodes.markDirtyMany(interfaceCopyNodes(iface), manager);
      });
    }

    return this._emitUpdated(id);
  }

  /** Перезапуск интерфейса на ноде (императивно, через команду агенту). */
  async restart(actor: AuthContext, id: string): Promise<WgNodeCommandDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_CONTROL,
    );

    return this._commands.createInterfaceRestart(
      iface.nodeId,
      actor.userId,
      iface.name,
    );
  }

  /** Назначить владельца интерфейса. */
  async assign(
    actor: AuthContext,
    id: string,
    body: IAssignWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_ASSIGN,
    );

    try {
      await this._repo.update({ id }, { ownerId: body.userId });
    } catch (err) {
      throw this._mapOwnerError(err);
    }

    return this._emitOwnerChanged(iface, body.userId);
  }

  /** Снять владельца интерфейса. */
  async revoke(actor: AuthContext, id: string): Promise<WgInterfaceDto> {
    const iface = await this.findFor(
      actor,
      id,
      WgInterfacePermissions.INTERFACE_ASSIGN,
    );

    await this._repo.update({ id }, { ownerId: null });

    return this._emitOwnerChanged(iface, null);
  }

  /**
   * Интерфейс для действия актора: невидимый — 404, видимый без права на
   * действие — 403. Проверка доступа и для других модулей домена.
   */
  findFor(
    actor: AuthContext,
    id: string,
    permission: string,
  ): Promise<WgInterface> {
    return findInterfaceFor(this._repo, actor, id, permission);
  }

  /** Ограничение списков интерфейсов областью просмотра; права нет — 403. */
  viewFilter(actor: AuthContext): { ownedBy?: string } {
    const filter = WgInterfaceAccess.filter(
      actor,
      WgInterfacePermissions.INTERFACE_VIEW,
    );

    if (!filter) throw WgInterfaceError.FORBIDDEN();

    return filter;
  }

  /** Отчёт агента о фактических статусах интерфейсов ноды. */
  async updateReportedStatuses(
    nodeId: string,
    reports: IWgInterfaceStatusReport[],
  ): Promise<void> {
    const interfaces = await this._repo.findForNode(nodeId);
    const byName = new Map(reports.map(report => [report.name, report]));

    for (const iface of interfaces) {
      const report = byName.get(iface.name);
      const status = report?.status ?? EWgInterfaceStatus.Unknown;
      const message = report?.message ?? null;

      if (iface.nodeId !== nodeId) {
        await this._replicas.updateStatus(iface.id, nodeId, status, message);
        continue;
      }
      if (iface.status === status && iface.statusMessage === message) continue;

      await this._repo.update(
        { id: iface.id },
        { status, statusMessage: message },
      );
      await this._emitUpdated(iface.id);
    }
  }

  /** Поднять версию всех нод интерфейса (основная и реплики) — изменились пиры. */
  async markInterfaceDirty(
    interfaceId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this._nodes.markDirtyMany(
      await this._repo.nodeIdsOf(interfaceId),
      manager,
    );
  }

  async findEntity(id: string): Promise<WgInterface> {
    return findInterfaceOrFail(this._repo, id);
  }

  /** Расшифрованный приватный ключ интерфейса (для desired state агента). */
  privateKeyOf(iface: WgInterface): string {
    return this._secrets.open(iface.privateKeyEnc);
  }

  /** Сохранение без связей: реплики и нода меняются отдельно. */
  private _withoutRelations(iface: WgInterface): WgInterface {
    const { replicas: _replicas, node: _node, ...rest } = iface;

    return rest as WgInterface;
  }

  private _emitUpdated(id: string): Promise<WgInterfaceDto> {
    return emitInterfaceUpdated(this._repo, this._eventBus, id);
  }

  private _emitOwnerChanged(
    iface: WgInterface,
    ownerId: string | null,
  ): Promise<WgInterfaceDto> {
    return emitInterfaceUpdated(
      this._repo,
      this._eventBus,
      iface.id,
      null,
      iface.ownerId !== ownerId ? iface.ownerId : null,
    );
  }

  /** Точка подключения интерфейса: должна быть видна актору. */
  private async _resolveEndpoint(
    actor: AuthContext,
    endpointId: string | null,
  ): Promise<WgEndpoint | null> {
    if (!endpointId) return null;

    return this._endpoints.findFor(
      actor,
      endpointId,
      WgEndpointPermissions.ENDPOINT_VIEW,
    );
  }

  /** Владелец не найден: единственная FK сохранения, не проверенная заранее. */
  private _mapOwnerError(err: unknown): unknown {
    return pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION
      ? WgInterfaceError.USER_NOT_FOUND()
      : this._mapUniqueError(err);
  }

  private _mapUniqueError(err: unknown): unknown {
    if (!isUniqueViolation(err)) return err;

    return pgConstraint(err) === "IDX_WG_INTERFACES_NODE_PORT"
      ? WgInterfaceError.PORT_TAKEN()
      : WgInterfaceError.NAME_TAKEN();
  }

  private async _dtoWithRelations(id: string): Promise<WgInterfaceDto> {
    return WgInterfaceDto.fromEntity(await findInterfaceOrFail(this._repo, id));
  }
}
