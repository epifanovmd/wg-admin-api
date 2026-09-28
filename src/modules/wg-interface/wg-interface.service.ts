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
import { hasPermission } from "../../core/auth/has-permission";
import { isSuperUser } from "../../core/auth/user-context";
import type { AuthContext } from "../../types/koa";
import { WgEndpoint, WgEndpointService } from "../wg-endpoint";
import {
  generateWgKeyPair,
  WgNodeCommandDto,
  WgNodeCommandService,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import type { ICreateWgInterfaceBody, IUpdateWgInterfaceBody } from "./dto";
import { WgInterfaceDto, WgInterfaceOptionDto } from "./dto";
import { WgInterfaceCreatedEvent, WgInterfaceDeletedEvent } from "./events";
import { WgInterface } from "./wg-interface.entity";
import { WgInterfaceError } from "./wg-interface.errors";
import { WgInterfaceGuard } from "./wg-interface.guard";
import {
  copyStatus,
  emitInterfaceUpdated,
  findInterfaceOrFail,
  interfaceCopyNodes,
} from "./wg-interface.lookup";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import type { IWgInterfaceFilters } from "./wg-interface.repository";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { EWgInterfaceStatus } from "./wg-interface.types";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";
import { WgRelaySyncService } from "./wg-relay-sync.service";

/** Фактический статус интерфейса из отчёта агента. */
export interface IWgInterfaceStatusReport {
  name: string;
  status: EWgInterfaceStatus;
  message?: string | null;
}

/**
 * WG-интерфейсы: CRUD, перенос, включение/выключение, статусы от агента.
 * Реплики — `WgInterfaceReplicaService`, проверки размещения — `WgInterfaceGuard`.
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
    this._assertCustomHooks(actor, body);
    await this._nodes.findEntity(body.nodeId);
    await this._guard.assertNodeFree(body.nodeId, body);

    const endpoint = await this._resolveEndpoint(body.endpointId ?? null);

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
      throw this._mapUniqueError(err);
    }

    await this._relaySync.syncRelaySafe(endpoint?.relayNodeId);

    const dto = await this._dtoWithRelations(created.id);

    this._eventBus.emit(new WgInterfaceCreatedEvent(dto));

    return dto;
  }

  async list(
    filters: IWgInterfaceFilters,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgInterfaceDto>> {
    const [items, total] = await this._repo.findPage(filters, pagination);

    return toPage(items.map(WgInterfaceDto.fromEntity), total, pagination);
  }

  async options(nodeId?: string): Promise<WgInterfaceOptionDto[]> {
    const items = await this._repo.find({
      where: nodeId ? { nodeId } : {},
      relations: { node: true },
      order: { name: "ASC" },
    });

    return items.map(WgInterfaceOptionDto.fromEntity);
  }

  async get(id: string): Promise<WgInterfaceDto> {
    return WgInterfaceDto.fromEntity(await findInterfaceOrFail(this._repo, id));
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    this._assertCustomHooks(actor, body);

    const iface = await findInterfaceOrFail(this._repo, id);
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

    if (body.endpointId !== undefined) {
      endpoint = await this._resolveEndpoint(body.endpointId);
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
  async move(id: string, targetNodeId: string): Promise<WgInterfaceDto> {
    const iface = await findInterfaceOrFail(this._repo, id);
    const previousNodeId = iface.nodeId;
    const endpoint = iface.endpoint ?? null;

    if (targetNodeId === previousNodeId) {
      throw WgInterfaceError.MOVE_SAME_NODE();
    }

    await this._nodes.findEntity(targetNodeId);
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
  async delete(id: string): Promise<void> {
    const iface = await findInterfaceOrFail(this._repo, id);

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
      ),
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<WgInterfaceDto> {
    const iface = await findInterfaceOrFail(this._repo, id);

    if (iface.enabled !== enabled) {
      await this._dataSource.transaction(async manager => {
        await this._repo.getRepository(manager).update({ id }, { enabled });
        await this._nodes.markDirtyMany(interfaceCopyNodes(iface), manager);
      });
    }

    return this._emitUpdated(id);
  }

  /** Перезапуск интерфейса на ноде (императивно, через команду агенту). */
  async restart(actorId: string, id: string): Promise<WgNodeCommandDto> {
    const iface = await findInterfaceOrFail(this._repo, id);

    return this._commands.createInterfaceRestart(
      iface.nodeId,
      actorId,
      iface.name,
    );
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

  private _assertCustomHooks(
    actor: AuthContext,
    body: Pick<ICreateWgInterfaceBody, "customPostUp" | "customPostDown">,
  ): void {
    const touchesHooks =
      (body.customPostUp !== undefined && body.customPostUp !== null) ||
      (body.customPostDown !== undefined && body.customPostDown !== null);

    const canSetHooks =
      isSuperUser(actor) ||
      hasPermission(actor.permissions, WgInterfacePermissions.INTERFACE_HOOKS);

    if (touchesHooks && !canSetHooks) {
      throw WgInterfaceError.CUSTOM_HOOKS_FORBIDDEN();
    }
  }

  private async _resolveEndpoint(
    endpointId: string | null,
  ): Promise<WgEndpoint | null> {
    if (!endpointId) return null;

    return this._endpoints.findEntity(endpointId);
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
