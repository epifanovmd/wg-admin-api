import { inject, multiInject, optional } from "inversify";
import { In } from "typeorm";

import type { IPaginatedDto, Pagination } from "../../core";
import {
  EventBus,
  Injectable,
  isUniqueViolation,
  PG_ERROR,
  pgErrorCode,
  toPage,
} from "../../core";
import { wgConfig, WgNodeError, WgNodeService } from "../wg-node";
import type { ICreateWgEndpointBody, IUpdateWgEndpointBody } from "./dto";
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
import { WgEndpoint } from "./wg-endpoint.entity";
import { WgEndpointError } from "./wg-endpoint.errors";
import { WgEndpointRepository } from "./wg-endpoint.repository";
import {
  EWgEndpointMode,
  EWgEndpointRoute,
  EWgForwardMode,
} from "./wg-endpoint.types";
import { WgRelayLink } from "./wg-relay-link.entity";
import { WgRelayLinkRepository } from "./wg-relay-link.repository";

const LINK_INSERT_ATTEMPTS = 3;

/** Точки подключения клиентов и линки релеев (адресация IPIP-туннелей). */
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

  async create(body: ICreateWgEndpointBody): Promise<WgEndpointDto> {
    await this._assertRelayNode(body.mode, body.relayNodeId ?? null);

    try {
      const endpoint = await this._endpoints.createAndSave({
        name: body.name,
        description: body.description ?? null,
        host: body.host,
        mode: body.mode,
        relayNodeId:
          body.mode === EWgEndpointMode.Relay ? body.relayNodeId : null,
        forwardMode: body.forwardMode ?? EWgForwardMode.Dnat,
        route: body.route ?? EWgEndpointRoute.Auto,
      });
      const dto = WgEndpointDto.fromEntity(endpoint);

      this._eventBus.emit(new WgEndpointCreatedEvent(dto));

      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw WgEndpointError.NAME_TAKEN();
      throw err;
    }
  }

  async list(
    query: string | undefined,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgEndpointDto>> {
    const [items, total] = await this._endpoints.findPage(query, pagination);

    return toPage(await this._toDtos(items), total, pagination);
  }

  async options(): Promise<WgEndpointOptionDto[]> {
    const items = await this._endpoints.find({ order: { name: "ASC" } });

    return items.map(WgEndpointOptionDto.fromEntity);
  }

  async get(id: string): Promise<WgEndpointDto> {
    const [dto] = await this._toDtos([await this._findOrFail(id)]);

    return dto;
  }

  async update(
    id: string,
    body: IUpdateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    const endpoint = await this._findOrFail(id);
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
    await this._assertRelayNode(endpoint.mode, endpoint.relayNodeId);
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

    const endpoints = await this._endpoints.find({ where: { id: In(ids) } });

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
  async delete(id: string): Promise<void> {
    const endpoint = await this._findOrFail(id);

    try {
      await this._endpoints.delete({ id: endpoint.id });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgEndpointError.IN_USE();
      }
      throw err;
    }

    this._eventBus.emit(new WgEndpointDeletedEvent(endpoint.id));
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

  private async _assertRelayNode(
    mode: EWgEndpointMode,
    relayNodeId: string | null,
  ): Promise<void> {
    if (mode !== EWgEndpointMode.Relay) return;
    if (!relayNodeId) throw WgEndpointError.RELAY_NODE_REQUIRED();

    try {
      await this._nodes.findEntity(relayNodeId);
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
    const endpoint = await this._endpoints.findOne({ where: { id } });

    if (!endpoint) throw WgEndpointError.NOT_FOUND();

    return endpoint;
  }
}
