import { inject, multiInject, optional } from "inversify";

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
import {
  wgConfig,
  WgNodeError,
  WgNodePermissions,
  WgNodeService,
} from "../wg-node";
import type {
  IAssignWgEndpointBody,
  ICreateWgEndpointBody,
  IUpdateWgEndpointBody,
} from "./dto";
import { WgEndpointDto, WgEndpointOptionDto } from "./dto";
import { IWgEndpointUsage, WG_ENDPOINT_USAGE } from "./endpoint-usage";
import {
  IWgEndpointConfigSnapshot,
  WgEndpointChangedEvent,
  WgEndpointCreatedEvent,
  WgEndpointDeletedEvent,
  WgEndpointInterfacesChangedEvent,
  WgEndpointUpdatedEvent,
} from "./events";
import { relayTunnelCapacity } from "./relay-tunnel";
import { WgEndpointAccess } from "./wg-endpoint.access";
import { WgEndpoint } from "./wg-endpoint.entity";
import { WgEndpointError } from "./wg-endpoint.errors";
import { WgEndpointPermissions } from "./wg-endpoint.permissions";
import { WgEndpointRepository } from "./wg-endpoint.repository";
import {
  EWgEndpointMode,
  EWgEndpointRoute,
  EWgForwardMode,
} from "./wg-endpoint.types";
import { WgRelayLink } from "./wg-relay-link.entity";
import { WgRelayLinkRepository } from "./wg-relay-link.repository";

const LINK_INSERT_ATTEMPTS = 3;

/**
 * Точки подключения клиентов с областью прав «все / свои» (владелец или
 * создатель) и линки релеев (адресация IPIP-туннелей). Чужая точка без права
 * на все не раскрывается (404); видимая без права на действие — 403. Методы
 * без актора — внутренние (агент, интерфейсы, статистика).
 */
@Injectable()
export class WgEndpointService {
  constructor(
    @inject(WgEndpointRepository)
    private readonly _endpoints: WgEndpointRepository,
    @inject(WgRelayLinkRepository)
    private readonly _links: WgRelayLinkRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @multiInject(WG_ENDPOINT_USAGE)
    @optional()
    private readonly _usage: IWgEndpointUsage[] | undefined = [],
  ) {}

  async create(
    actor: AuthContext,
    body: ICreateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    const ownerId = body.ownerId ?? null;

    if (
      ownerId !== null &&
      ownerId !== actor.userId &&
      !WgEndpointAccess.scope(actor, WgEndpointPermissions.ENDPOINT_ASSIGN)
    ) {
      throw WgEndpointError.FORBIDDEN();
    }
    await this._assertRelayNode(actor, body.mode, body.relayNodeId ?? null);

    try {
      const endpoint = await this._endpoints.createAndSave({
        ownerId,
        createdById: actor.userId,
        name: body.name,
        description: body.description ?? null,
        host: body.host,
        mode: body.mode,
        relayNodeId:
          body.mode === EWgEndpointMode.Relay ? body.relayNodeId : null,
        forwardMode: body.forwardMode ?? EWgForwardMode.Dnat,
        route: body.route ?? EWgEndpointRoute.Auto,
      });
      const dto = WgEndpointDto.fromEntity(await this._findOrFail(endpoint.id));

      this._eventBus.emit(new WgEndpointCreatedEvent(dto));

      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw WgEndpointError.NAME_TAKEN();
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION && ownerId) {
        throw WgEndpointError.USER_NOT_FOUND();
      }
      throw err;
    }
  }

  /** Точки в рамках прав; `mine` — только свои при любой области. */
  async list(
    actor: AuthContext,
    { query, mine }: { query?: string; mine?: boolean },
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgEndpointDto>> {
    const [items, total] = await this._endpoints.findPage(
      { query, ...this.viewFilter(actor, mine) },
      pagination,
    );

    return toPage(await this._toDtos(items), total, pagination);
  }

  async options(
    actor: AuthContext,
    mine?: boolean,
  ): Promise<WgEndpointOptionDto[]> {
    const { ownedBy } = this.viewFilter(actor, mine);
    const items = await this._endpoints.find({
      where: ownedBy ? WgEndpointAccess.ownedWhere(ownedBy) : {},
      order: { name: "ASC" },
    });

    return items.map(WgEndpointOptionDto.fromEntity);
  }

  async get(actor: AuthContext, id: string): Promise<WgEndpointDto> {
    const endpoint = await this.findFor(
      actor,
      id,
      WgEndpointPermissions.ENDPOINT_VIEW,
    );
    const [dto] = await this._toDtos([endpoint]);

    return dto;
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    const endpoint = await this.findFor(
      actor,
      id,
      WgEndpointPermissions.ENDPOINT_UPDATE,
    );
    const previous: IWgEndpointConfigSnapshot = {
      host: endpoint.host,
      mode: endpoint.mode,
      relayNodeId: endpoint.relayNodeId,
      forwardMode: endpoint.forwardMode,
      route: endpoint.route,
    };

    if (body.name !== undefined) endpoint.name = body.name;
    if (body.description !== undefined) endpoint.description = body.description;
    if (body.host !== undefined) endpoint.host = body.host;
    if (body.mode !== undefined) endpoint.mode = body.mode;
    if (body.relayNodeId !== undefined) endpoint.relayNodeId = body.relayNodeId;
    if (body.forwardMode !== undefined) endpoint.forwardMode = body.forwardMode;
    if (body.route !== undefined) endpoint.route = body.route;

    if (endpoint.mode === EWgEndpointMode.Direct) endpoint.relayNodeId = null;
    // Видимость релея проверяется при его выборе: прежний мог назначить другой.
    if (
      !endpoint.relayNodeId ||
      endpoint.relayNodeId !== previous.relayNodeId
    ) {
      await this._assertRelayNode(actor, endpoint.mode, endpoint.relayNodeId);
    }
    if (endpoint.relayNodeId && endpoint.relayNodeId !== previous.relayNodeId) {
      await this._assertRelayNotTarget(endpoint.id, endpoint.relayNodeId);
      await this._assertRelayPortsFree(endpoint.id, endpoint.relayNodeId);
    }

    try {
      const [dto] = await this._toDtos([await this._endpoints.save(endpoint)]);
      const configChanged =
        previous.host !== endpoint.host ||
        previous.mode !== endpoint.mode ||
        previous.relayNodeId !== endpoint.relayNodeId ||
        previous.forwardMode !== endpoint.forwardMode ||
        previous.route !== endpoint.route;

      if (configChanged) {
        this._eventBus.emit(new WgEndpointUpdatedEvent(dto, previous));
      }
      this._eventBus.emit(new WgEndpointChangedEvent(dto));

      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw WgEndpointError.NAME_TAKEN();
      throw err;
    }
  }

  /**
   * Интерфейсы точек изменились — актуальные DTO подписчикам списка точек
   * («куда ведёт»). Удалённые и пустые id пропускаются.
   */
  async publishInterfacesChanged(
    endpointIds: Array<string | null | undefined>,
  ): Promise<void> {
    const ids = [...new Set(endpointIds.filter((id): id is string => !!id))];

    if (ids.length === 0) return;

    const endpoints = await this._endpoints.findManyWithOwners(ids);

    for (const dto of await this._toDtos(endpoints)) {
      this._eventBus.emit(new WgEndpointInterfacesChangedEvent(dto));
    }
  }

  /** DTO точек с интерфейсами, которые через них подключены. */
  private async _toDtos(endpoints: WgEndpoint[]): Promise<WgEndpointDto[]> {
    const ids = endpoints.map(endpoint => endpoint.id);
    const byEndpoint = await Promise.all(
      (this._usage ?? []).map(usage => usage.interfacesByEndpoint(ids)),
    );

    return endpoints.map(endpoint =>
      WgEndpointDto.fromEntity(
        endpoint,
        byEndpoint.flatMap(interfaces => interfaces[endpoint.id] ?? []),
      ),
    );
  }

  /** Удалить точку подключения; используемая интерфейсами — 409. */
  async delete(actor: AuthContext, id: string): Promise<void> {
    const endpoint = await this.findFor(
      actor,
      id,
      WgEndpointPermissions.ENDPOINT_DELETE,
    );

    try {
      await this._endpoints.delete({ id: endpoint.id });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgEndpointError.IN_USE();
      }
      throw err;
    }

    this._eventBus.emit(
      new WgEndpointDeletedEvent(
        endpoint.id,
        endpoint.ownerId,
        endpoint.createdById,
      ),
    );
  }

  /** Назначить владельца точки. */
  async assign(
    actor: AuthContext,
    id: string,
    body: IAssignWgEndpointBody,
  ): Promise<WgEndpointDto> {
    const endpoint = await this.findFor(
      actor,
      id,
      WgEndpointPermissions.ENDPOINT_ASSIGN,
    );

    try {
      await this._endpoints.update({ id }, { ownerId: body.userId });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgEndpointError.USER_NOT_FOUND();
      }
      throw err;
    }

    return this._emitOwnerChanged(endpoint, body.userId);
  }

  /** Снять владельца точки. */
  async revoke(actor: AuthContext, id: string): Promise<WgEndpointDto> {
    const endpoint = await this.findFor(
      actor,
      id,
      WgEndpointPermissions.ENDPOINT_ASSIGN,
    );

    await this._endpoints.update({ id }, { ownerId: null });

    return this._emitOwnerChanged(endpoint, null);
  }

  /**
   * Точка для действия актора: невидимая — 404, видимая без права на
   * действие — 403. Проверка доступа и для других модулей домена.
   */
  async findFor(
    actor: AuthContext,
    id: string,
    permission: string,
  ): Promise<WgEndpoint> {
    const endpoint = await this._findOrFail(id);

    if (
      !WgEndpointAccess.can(
        actor,
        WgEndpointPermissions.ENDPOINT_VIEW,
        endpoint,
      )
    ) {
      throw WgEndpointError.NOT_FOUND();
    }
    if (!WgEndpointAccess.can(actor, permission, endpoint)) {
      throw WgEndpointError.FORBIDDEN();
    }

    return endpoint;
  }

  /**
   * Ограничение списков точек областью просмотра; `mine` — только свои при
   * любой области; права нет — 403.
   */
  viewFilter(actor: AuthContext, mine?: boolean): { ownedBy?: string } {
    const filter = WgEndpointAccess.listFilter(
      actor,
      WgEndpointPermissions.ENDPOINT_VIEW,
      mine,
    );

    if (!filter) throw WgEndpointError.FORBIDDEN();

    return filter;
  }

  async findEntity(id: string): Promise<WgEndpoint> {
    return this._findOrFail(id);
  }

  /** Линк релей→цель: существующий или новый с первым свободным /30. */
  async ensureLink(
    relayNodeId: string,
    targetNodeId: string,
  ): Promise<WgRelayLink> {
    const existing = await this._links.findPair(relayNodeId, targetNodeId);

    if (existing) return existing;

    for (let attempt = 1; ; attempt += 1) {
      const tunnelIndex = await this._links.nextTunnelIndex();

      if (tunnelIndex >= relayTunnelCapacity(wgConfig.relayTunnelCidr)) {
        throw WgEndpointError.TUNNEL_CAPACITY_EXCEEDED();
      }

      try {
        return await this._links.createAndSave({
          relayNodeId,
          targetNodeId,
          tunnelIndex,
        });
      } catch (err) {
        // Гонка за индекс или пару: пара уже создана — вернуть её.
        if (!isUniqueViolation(err) || attempt >= LINK_INSERT_ATTEMPTS) {
          throw err;
        }

        const raced = await this._links.findPair(relayNodeId, targetNodeId);

        if (raced) return raced;
      }
    }
  }

  async deleteLink(relayNodeId: string, targetNodeId: string): Promise<void> {
    await this._links.delete({ relayNodeId, targetNodeId });
  }

  /** Линки ноды в обеих ролях (релей и цель). */
  async linksForNode(nodeId: string): Promise<WgRelayLink[]> {
    const [asRelay, asTarget] = await Promise.all([
      this._links.findByRelay(nodeId),
      this._links.findByTarget(nodeId),
    ]);

    return [...asRelay, ...asTarget];
  }

  linksForRelay(relayNodeId: string): Promise<WgRelayLink[]> {
    return this._links.findByRelay(relayNodeId);
  }

  linksForTarget(targetNodeId: string): Promise<WgRelayLink[]> {
    return this._links.findByTarget(targetNodeId);
  }

  /** Релей не может обслуживать точку для интерфейсов на самом себе. */
  private async _assertRelayNotTarget(
    endpointId: string,
    relayNodeId: string,
  ): Promise<void> {
    for (const usage of this._usage ?? []) {
      if ((await usage.targetNodeIds(endpointId)).includes(relayNodeId)) {
        throw WgEndpointError.RELAY_IS_TARGET();
      }
    }
  }

  private async _assertRelayPortsFree(
    endpointId: string,
    relayNodeId: string,
  ): Promise<void> {
    for (const usage of this._usage ?? []) {
      if (await usage.relayPortConflict(endpointId, relayNodeId)) {
        throw WgEndpointError.RELAY_PORT_CONFLICT();
      }
    }
  }

  private async _emitOwnerChanged(
    endpoint: WgEndpoint,
    ownerId: string | null,
  ): Promise<WgEndpointDto> {
    const [dto] = await this._toDtos([await this._findOrFail(endpoint.id)]);

    this._eventBus.emit(
      new WgEndpointChangedEvent(
        dto,
        endpoint.ownerId !== ownerId ? endpoint.ownerId : null,
      ),
    );

    return dto;
  }

  /** Релей-нода обязательна для relay и должна быть видна актору. */
  private async _assertRelayNode(
    actor: AuthContext,
    mode: EWgEndpointMode,
    relayNodeId: string | null,
  ): Promise<void> {
    if (mode !== EWgEndpointMode.Relay) return;
    if (!relayNodeId) throw WgEndpointError.RELAY_NODE_REQUIRED();

    try {
      await this._nodes.findFor(
        actor,
        relayNodeId,
        WgNodePermissions.NODE_VIEW,
      );
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        err.code === WgNodeError.codes.NOT_FOUND
      ) {
        throw WgEndpointError.RELAY_NODE_NOT_FOUND();
      }
      throw err;
    }
  }

  private async _findOrFail(id: string): Promise<WgEndpoint> {
    const endpoint = await this._endpoints.findWithOwners(id);

    if (!endpoint) throw WgEndpointError.NOT_FOUND();

    return endpoint;
  }
}
