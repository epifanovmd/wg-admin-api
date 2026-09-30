import { inject, multiInject, optional } from "inversify";
import { DataSource, In } from "typeorm";

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
  IWgRelayConsumer,
  WG_RELAY_CONSUMER,
  WgInterfaceRepository,
  WgRelaySyncService,
} from "../wg-interface";
import { WgNode, WgNodePermissions, WgNodeService } from "../wg-node";
import { WgLiveStore } from "../wg-stats";
import type {
  IAssignWgForwardBody,
  ICreateWgForwardBody,
  IUpdateWgForwardBody,
} from "./dto";
import { WgForwardDto } from "./dto";
import { WgForwardDeletedEvent, WgForwardUpdatedEvent } from "./events";
import { WgForwardAccess } from "./wg-forward.access";
import { WgForward } from "./wg-forward.entity";
import { WgForwardError } from "./wg-forward.errors";
import { WgForwardPermissions } from "./wg-forward.permissions";
import { WgForwardRepository } from "./wg-forward.repository";
import {
  EWgForwardActiveRoute,
  EWgForwardPath,
  EWgForwardProtocol,
  EWgForwardRoute,
} from "./wg-forward.types";

/** Отчёт агента живёт дольше интервала статистики с запасом. */
const ROUTE_TTL_SEC = 60;
const routeKey = (id: string): string => `forward-route:${id}`;

/**
 * Пробросы портов на релее до внешних сервисов с областью прав «все / свои»
 * (владелец или создатель): чужой проброс без права на все не раскрывается
 * (404), видимый без права на действие — 403; релей и нода-цель выбираются
 * только из видимых нод. Изменение поднимает версию релея (в транзакции) и
 * пересинхронизирует его линки: цель пути `ipip` получает свой конец туннеля.
 */
@Injectable()
export class WgForwardService {
  constructor(
    @inject(WgForwardRepository) private readonly _repo: WgForwardRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgRelaySyncService) private readonly _relaySync: WgRelaySyncService,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
    @inject(DataSource) private readonly _dataSource: DataSource,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @multiInject(WG_RELAY_CONSUMER)
    @optional()
    private readonly _consumers: IWgRelayConsumer[] | undefined = [],
  ) {}

  async create(
    actor: AuthContext,
    body: ICreateWgForwardBody,
  ): Promise<WgForwardDto> {
    const ownerId = body.ownerId ?? null;

    if (
      ownerId !== null &&
      ownerId !== actor.userId &&
      !WgForwardAccess.scope(actor, WgForwardPermissions.FORWARD_ASSIGN)
    ) {
      throw WgForwardError.FORBIDDEN();
    }
    await this._assertNodeVisible(actor, body.relayNodeId);
    await this._assertNodeVisible(actor, body.targetNodeId ?? null);

    const draft = this._repo.create({
      ownerId,
      createdById: actor.userId,
      name: body.name,
      description: body.description ?? null,
      relayNodeId: body.relayNodeId,
      protocol: body.protocol,
      listenPort: body.listenPort,
      targetNodeId: body.targetNodeId ?? null,
      targetHost: body.targetHost ?? null,
      targetPort: body.targetPort,
      path: body.path,
      route: body.route ?? EWgForwardRoute.Auto,
      enabled: body.enabled ?? true,
    });

    await this._validate(draft, { checkHost: draft.enabled });

    try {
      return await this._save(draft);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION && ownerId) {
        throw WgForwardError.USER_NOT_FOUND();
      }
      throw err;
    }
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgForwardBody,
  ): Promise<WgForwardDto> {
    const forward = await this.findFor(
      actor,
      id,
      WgForwardPermissions.FORWARD_UPDATE,
    );
    const portChanged =
      body.listenPort !== undefined && body.listenPort !== forward.listenPort;

    if (body.name !== undefined) forward.name = body.name;
    if (body.description !== undefined) forward.description = body.description;
    if (body.listenPort !== undefined) forward.listenPort = body.listenPort;
    if (
      body.targetNodeId !== undefined &&
      body.targetNodeId !== forward.targetNodeId
    ) {
      await this._assertNodeVisible(actor, body.targetNodeId);
      forward.targetNodeId = body.targetNodeId;
      forward.targetNode = undefined;
    }
    if (body.targetHost !== undefined) forward.targetHost = body.targetHost;
    if (body.targetPort !== undefined) forward.targetPort = body.targetPort;
    if (body.path !== undefined) forward.path = body.path;
    if (body.route !== undefined) forward.route = body.route;
    if (body.enabled !== undefined) forward.enabled = body.enabled;

    await this._validate(forward, {
      checkHost: forward.enabled && portChanged,
    });

    return this._save(forward);
  }

  async delete(actor: AuthContext, id: string): Promise<void> {
    const forward = await this.findFor(
      actor,
      id,
      WgForwardPermissions.FORWARD_DELETE,
    );

    await this._dataSource.transaction(async manager => {
      await this._repo.getRepository(manager).delete({ id: forward.id });
      await this._nodes.markDirty(forward.relayNodeId, manager);
    });
    await this._relaySync.syncRelaySafe(forward.relayNodeId);
    this._eventBus.emit(
      new WgForwardDeletedEvent(
        forward.id,
        forward.ownerId,
        forward.createdById,
      ),
    );
  }

  async list(
    actor: AuthContext,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgForwardDto>> {
    const filter = WgForwardAccess.filter(
      actor,
      WgForwardPermissions.FORWARD_VIEW,
    );

    if (!filter) throw WgForwardError.FORBIDDEN();

    const [items, total] = await this._repo.findPage(
      pagination,
      filter.ownedBy,
    );

    return toPage(await this._toDtos(items), total, pagination);
  }

  async get(actor: AuthContext, id: string): Promise<WgForwardDto> {
    const [dto] = await this._toDtos([
      await this.findFor(actor, id, WgForwardPermissions.FORWARD_VIEW),
    ]);

    return dto;
  }

  /** Назначить владельца проброса. */
  async assign(
    actor: AuthContext,
    id: string,
    body: IAssignWgForwardBody,
  ): Promise<WgForwardDto> {
    const forward = await this.findFor(
      actor,
      id,
      WgForwardPermissions.FORWARD_ASSIGN,
    );

    try {
      await this._repo.update({ id }, { ownerId: body.userId });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgForwardError.USER_NOT_FOUND();
      }
      throw err;
    }

    return this._emitOwnerChanged(forward, body.userId);
  }

  /** Снять владельца проброса. */
  async revoke(actor: AuthContext, id: string): Promise<WgForwardDto> {
    const forward = await this.findFor(
      actor,
      id,
      WgForwardPermissions.FORWARD_ASSIGN,
    );

    await this._repo.update({ id }, { ownerId: null });

    return this._emitOwnerChanged(forward, null);
  }

  /** Проброс для действия актора: невидимый — 404, без права на действие — 403. */
  async findFor(
    actor: AuthContext,
    id: string,
    permission: string,
  ): Promise<WgForward> {
    const forward = await this._findOrFail(id);

    if (
      !WgForwardAccess.can(actor, WgForwardPermissions.FORWARD_VIEW, forward)
    ) {
      throw WgForwardError.NOT_FOUND();
    }
    if (!WgForwardAccess.can(actor, permission, forward)) {
      throw WgForwardError.FORBIDDEN();
    }

    return forward;
  }

  /** Отчёт агента релея об активных маршрутах его пробросов. */
  async recordRoutes(
    relayNodeId: string,
    routes: Array<{ id: string; activeRoute: EWgForwardActiveRoute }>,
  ): Promise<void> {
    if (routes.length === 0) return;

    const own = await this._repo.find({
      where: { id: In(routes.map(route => route.id)), relayNodeId },
      select: { id: true },
    });
    const ownIds = new Set(own.map(forward => forward.id));

    for (const route of routes) {
      if (!ownIds.has(route.id)) continue;

      const previous = await this._live.getJson<EWgForwardActiveRoute>(
        routeKey(route.id),
      );

      await this._live.setJson(
        routeKey(route.id),
        route.activeRoute,
        ROUTE_TTL_SEC,
      );
      // Агент шлёт маршрут с каждой статистикой — событие только при смене.
      if (previous !== route.activeRoute) {
        this._eventBus.emit(
          new WgForwardUpdatedEvent(await this._dto(route.id)),
        );
      }
    }
  }

  private async _dto(id: string): Promise<WgForwardDto> {
    const [dto] = await this._toDtos([await this._findOrFail(id)]);

    return dto;
  }

  private async _emitOwnerChanged(
    forward: WgForward,
    ownerId: string | null,
  ): Promise<WgForwardDto> {
    const dto = await this._dto(forward.id);

    this._eventBus.emit(
      new WgForwardUpdatedEvent(
        dto,
        forward.ownerId !== ownerId ? forward.ownerId : null,
      ),
    );

    return dto;
  }

  /** Нода проброса (релей или цель) должна быть видна актору. */
  private async _assertNodeVisible(
    actor: AuthContext,
    nodeId: string | null,
  ): Promise<void> {
    if (nodeId) {
      await this._nodes.findFor(actor, nodeId, WgNodePermissions.NODE_VIEW);
    }
  }

  private async _toDtos(items: WgForward[]): Promise<WgForwardDto[]> {
    return Promise.all(
      items.map(async forward =>
        WgForwardDto.fromEntity(
          forward,
          await this._live.getJson<EWgForwardActiveRoute>(routeKey(forward.id)),
        ),
      ),
    );
  }

  private async _save(forward: WgForward): Promise<WgForwardDto> {
    let saved: WgForward;

    try {
      saved = await this._dataSource.transaction(async manager => {
        const result = await this._repo.getRepository(manager).save(forward);

        await this._nodes.markDirty(forward.relayNodeId, manager);

        return result;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      throw pgConstraint(err) === "IDX_WG_FORWARDS_NAME"
        ? WgForwardError.NAME_TAKEN()
        : WgForwardError.PORT_TAKEN();
    }

    await this._relaySync.syncRelaySafe(forward.relayNodeId);

    const dto = await this._dto(saved.id);

    this._eventBus.emit(new WgForwardUpdatedEvent(dto));

    return dto;
  }

  /**
   * Цель, путь и свобода порта на релее. Порты процессов хоста (по отчёту
   * агента, до минуты давности) — только при создании включённого проброса и
   * смене порта: включение заранее созданного проверяет сам агент релея
   * (откажется, пока порт занят, и применит, когда освободится).
   */
  private async _validate(
    forward: WgForward,
    { checkHost }: { checkHost: boolean },
  ): Promise<void> {
    const relay = await this._nodes.findEntity(forward.relayNodeId);
    const target = forward.targetNodeId
      ? await this._nodes.findEntity(forward.targetNodeId)
      : null;

    if (!target && !forward.targetHost) throw WgForwardError.TARGET_REQUIRED();
    if (target?.id === relay.id) throw WgForwardError.TARGET_IS_RELAY();
    if (forward.path === EWgForwardPath.Ipip && !target) {
      throw WgForwardError.IPIP_NEEDS_NODE();
    }

    const directAddress = forward.targetHost ?? target?.publicHost ?? null;

    if (
      !directAddress &&
      (forward.path === EWgForwardPath.Direct ||
        forward.route !== EWgForwardRoute.Tunnel)
    ) {
      throw WgForwardError.NO_DIRECT_ADDRESS();
    }

    await this._assertPortFree(relay, forward, checkHost);
  }

  /**
   * Порт на релее: другие пробросы, WireGuard-интерфейсы и точки
   * подключения (UDP), а также процессы хоста по отчёту агента.
   */
  private async _assertPortFree(
    relay: WgNode,
    forward: WgForward,
    checkHost: boolean,
  ): Promise<void> {
    const { protocol, listenPort: port } = forward;
    const other = await this._repo.findOne({
      where: { relayNodeId: relay.id, protocol, listenPort: port },
      select: { id: true },
    });
    const hostPorts =
      protocol === EWgForwardProtocol.Udp
        ? relay.osInfo?.udpPorts
        : relay.osInfo?.tcpPorts;
    // Выключенный проброс порт не держит — конфликт с интерфейсами, точками
    // и другими модулями проверяется при включении.
    const udpTaken =
      forward.enabled &&
      protocol === EWgForwardProtocol.Udp &&
      ((await this._interfaces.nodeListenPortInUse(relay.id, port)) ||
        (await this._interfaces.relayForwardPortInUse(relay.id, port)));

    if (
      (other && other.id !== forward.id) ||
      udpTaken ||
      (forward.enabled && (await this._claimedByOthers(relay.id, forward))) ||
      (checkHost && hostPorts?.includes(port))
    ) {
      throw WgForwardError.PORT_TAKEN();
    }
  }

  /** Порт занят другим модулем на ноде (например, прокси-сервисом). */
  private async _claimedByOthers(
    nodeId: string,
    forward: WgForward,
  ): Promise<boolean> {
    for (const consumer of this._consumers ?? []) {
      const claims = await consumer.claimedPorts(nodeId);

      if (
        claims.some(
          claim =>
            claim.protocol === forward.protocol &&
            claim.port === forward.listenPort &&
            claim.ownerId !== forward.id,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private async _findOrFail(id: string): Promise<WgForward> {
    const forward = await this._repo.findWithNodes(id);

    if (!forward) throw WgForwardError.NOT_FOUND();

    return forward;
  }
}
