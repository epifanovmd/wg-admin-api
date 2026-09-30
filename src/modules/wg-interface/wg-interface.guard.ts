import { inject, multiInject, optional } from "inversify";

import { Injectable } from "../../core";
import type { AuthContext } from "../../types/koa";
import { EWgEndpointMode, WgEndpoint } from "../wg-endpoint";
import { WgNodeAccess, WgNodePermissions, WgNodeService } from "../wg-node";
import { IWgRelayConsumer, WG_RELAY_CONSUMER } from "./relay-extensions";
import { WgInterfaceError } from "./wg-interface.errors";
import { WgInterfaceRepository } from "./wg-interface.repository";

/** У интерфейса есть произвольные PostUp/PostDown. */
export const hasHooks = (iface: {
  customPostUp: string | null;
  customPostDown: string | null;
}): boolean => Boolean(iface.customPostUp || iface.customPostDown);

/** Размещение интерфейса (или его копии) на ноде с учётом релея точки. */
export interface IWgInterfacePlacement {
  /** Id интерфейса — не конфликтует сам с собой. */
  id?: string;
  nodeId: string;
  listenPort: number;
  endpointPort: number | null;
  endpoint: WgEndpoint | null;
}

/**
 * Проверки размещения интерфейса: имя и порт на ноде, порт точки
 * подключения, UDP-порты релея и пробросы других модулей.
 */
@Injectable()
export class WgInterfaceGuard {
  constructor(
    @inject(WgInterfaceRepository)
    private readonly _repo: WgInterfaceRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @multiInject(WG_RELAY_CONSUMER)
    @optional()
    private readonly _relayConsumers: IWgRelayConsumer[] | undefined = [],
  ) {}

  /**
   * Имя и порт свободны на ноде с учётом реплик чужих интерфейсов (индексы БД
   * видят только основные ноды).
   */
  async assertNodeFree(
    nodeId: string,
    iface: { id?: string; name: string; listenPort: number },
  ): Promise<void> {
    if (await this._repo.nodeNameInUse(nodeId, iface.name, iface.id)) {
      throw WgInterfaceError.NAME_TAKEN();
    }
    if (
      await this._repo.nodeListenPortInUse(nodeId, iface.listenPort, iface.id)
    ) {
      throw WgInterfaceError.PORT_TAKEN();
    }
  }

  /**
   * Произвольные PostUp/PostDown выполняются root-командами на ноде: кроме
   * права на хуки интерфейса нужно право изменять каждую ноду, где они
   * окажутся (все ноды или своя).
   */
  async assertHooksAllowedOn(
    actor: AuthContext,
    nodeIds: readonly string[],
  ): Promise<void> {
    for (const nodeId of new Set(nodeIds)) {
      const node = await this._nodes.findEntity(nodeId);

      if (!WgNodeAccess.can(actor, WgNodePermissions.NODE_UPDATE, node)) {
        throw WgInterfaceError.CUSTOM_HOOKS_FORBIDDEN();
      }
    }
  }

  /** Точка с релеем на ноде самого интерфейса дала бы туннель сам в себя. */
  assertRelayNotSelf(endpoint: WgEndpoint, nodeId: string): void {
    if (
      endpoint.mode === EWgEndpointMode.Relay &&
      endpoint.relayNodeId === nodeId
    ) {
      throw WgInterfaceError.ENDPOINT_RELAY_IS_NODE();
    }
  }

  /** Эффективный порт свободен на точке подключения. */
  async assertEndpointPortFree(
    endpointId: string,
    effectivePort: number,
    excludeId?: string,
  ): Promise<void> {
    if (
      await this._repo.endpointPortInUse(endpointId, effectivePort, excludeId)
    ) {
      throw WgInterfaceError.ENDPOINT_PORT_TAKEN();
    }
  }

  /**
   * UDP-порты релея общие для его relay-точек и собственных интерфейсов:
   * DNAT в PREROUTING перехватил бы трафик, пришедший на тот же порт.
   */
  async assertRelayPortsFree(target: IWgInterfacePlacement): Promise<void> {
    const { endpoint } = target;

    if (endpoint?.mode === EWgEndpointMode.Relay && endpoint.relayNodeId) {
      const port = target.endpointPort ?? target.listenPort;
      const relay = await this._nodes.findEntity(endpoint.relayNodeId);

      // Порт слушает не wg-admin (nginx, другой VPN): DNAT перехватил бы
      // его трафик. Список — из последнего отчёта агента релея.
      if (relay.osInfo?.udpPorts?.includes(port)) {
        throw WgInterfaceError.RELAY_PORT_BUSY();
      }

      if (
        (await this._repo.nodeListenPortInUse(endpoint.relayNodeId, port)) ||
        (await this._repo.relayForwardPortInUse(endpoint.relayNodeId, port, {
          interfaceId: target.id,
        })) ||
        (await this._udpClaimed(endpoint.relayNodeId, port))
      ) {
        throw WgInterfaceError.RELAY_PORT_TAKEN();
      }
    }

    if (
      (await this._repo.relayForwardPortInUse(
        target.nodeId,
        target.listenPort,
        { interfaceId: target.id },
      )) ||
      (await this._udpClaimed(target.nodeId, target.listenPort))
    ) {
      throw WgInterfaceError.PORT_FORWARDED();
    }
  }

  /** UDP-порт на ноде занят пробросом другого модуля (релей портов). */
  private async _udpClaimed(nodeId: string, port: number): Promise<boolean> {
    for (const consumer of this._relayConsumers ?? []) {
      const claims = await consumer.claimedPorts(nodeId);

      if (claims.some(c => c.protocol === "udp" && c.port === port)) {
        return true;
      }
    }

    return false;
  }
}
