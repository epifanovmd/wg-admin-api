import { inject, multiInject, optional } from "inversify";
import { DataSource, In } from "typeorm";

import type { IPaginatedDto, Pagination } from "../../core";
import {
  EventBus,
  Injectable,
  isUniqueViolation,
  pgConstraint,
  toPage,
} from "../../core";
import {
  IWgRelayConsumer,
  WG_RELAY_CONSUMER,
  WgInterfaceRepository,
  WgRelaySyncService,
} from "../wg-interface";
import { WgNode, WgNodeService } from "../wg-node";
import { WgLiveStore } from "../wg-stats";
import type { ICreateWgForwardBody, IUpdateWgForwardBody } from "./dto";
import { WgForwardDto } from "./dto";
import { WgForwardDeletedEvent, WgForwardUpdatedEvent } from "./events";
import { WgForward } from "./wg-forward.entity";
import { WgForwardError } from "./wg-forward.errors";
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
 * Пробросы портов на релее до внешних сервисов. Изменение поднимает версию
 * релея (в транзакции) и пересинхронизирует его линки: цель пути `ipip`
 * получает свой конец туннеля.
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

  async create(body: ICreateWgForwardBody): Promise<WgForwardDto> {
    const draft = this._repo.create({
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

    return this._save(draft);
  }

  async update(id: string, body: IUpdateWgForwardBody): Promise<WgForwardDto> {
    const forward = await this._findOrFail(id);
    const portChanged =
      body.listenPort !== undefined && body.listenPort !== forward.listenPort;

    if (body.name !== undefined) forward.name = body.name;
    if (body.description !== undefined) forward.description = body.description;
    if (body.listenPort !== undefined) forward.listenPort = body.listenPort;
    if (body.targetNodeId !== undefined) {
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

  async delete(id: string): Promise<void> {
    const forward = await this._findOrFail(id);

    await this._dataSource.transaction(async manager => {
      await this._repo.getRepository(manager).delete({ id: forward.id });
      await this._nodes.markDirty(forward.relayNodeId, manager);
    });
    await this._relaySync.syncRelaySafe(forward.relayNodeId);
    this._eventBus.emit(new WgForwardDeletedEvent(forward.id));
  }

  async list(pagination: Pagination): Promise<IPaginatedDto<WgForwardDto>> {
    const [items, total] = await this._repo.findPage(pagination);

    return toPage(await this._toDtos(items), total, pagination);
  }

  async get(id: string): Promise<WgForwardDto> {
    const [dto] = await this._toDtos([await this._findOrFail(id)]);

    return dto;
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
          new WgForwardUpdatedEvent(await this.get(route.id)),
        );
      }
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

    const dto = await this.get(saved.id);

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
    const udpTaken =
      protocol === EWgForwardProtocol.Udp &&
      ((await this._interfaces.nodeListenPortInUse(relay.id, port)) ||
        (await this._interfaces.relayForwardPortInUse(relay.id, port)));

    if (
      (other && other.id !== forward.id) ||
      udpTaken ||
      (await this._claimedByOthers(relay.id, forward)) ||
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
