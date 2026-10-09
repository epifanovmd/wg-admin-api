import { inject } from "inversify";
import { In } from "typeorm";

import { Injectable, logger } from "../../core";
import {
  EWgEndpointMode,
  EWgEndpointRoute,
  EWgForwardMode,
  relayTunnelAddresses,
  relayTunnelName,
  WgEndpointService,
} from "../wg-endpoint";
import { EWgForwardPath, WgForwardRepository } from "../wg-forward";
import {
  EWgInterfaceStatus,
  WgInterfaceRepository,
  WgInterfaceService,
} from "../wg-interface";
import { wgConfig, WgNode, WgNodeRepository } from "../wg-node";
import { WgPeerService } from "../wg-peer";
import { WgSocksAppService } from "../wg-socks";
import { WgMeshService } from "../wg-stats";
import {
  ISocksProxiesConfig,
  IWgProbesConfig,
  IWgStateConfig,
  IWgWorkerForward,
  IWgWorkerTunnel,
  WG_TUNNEL_MTU,
} from "./wg-worker.contract";

/** Настройки воркеров ноды целиком. */
export interface IWgNodeWorkerConfigs {
  state: IWgStateConfig;
  probes: IWgProbesConfig;
  proxies: ISocksProxiesConfig;
}

/**
 * Сборка настроек воркеров ноды из домена: желаемое состояние воркера wg
 * (интерфейсы с пирами, IPIP-туннели, пробросы релея), цели проб связности,
 * SOCKS-прокси.
 */
@Injectable()
export class WgAgentStateService {
  constructor(
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
    @inject(WgInterfaceRepository)
    private readonly _interfaceRepo: WgInterfaceRepository,
    @inject(WgInterfaceService)
    private readonly _interfaces: WgInterfaceService,
    @inject(WgPeerService) private readonly _peers: WgPeerService,
    @inject(WgEndpointService) private readonly _endpoints: WgEndpointService,
    @inject(WgMeshService) private readonly _mesh: WgMeshService,
    @inject(WgForwardRepository)
    private readonly _forwards: WgForwardRepository,
    @inject(WgSocksAppService) private readonly _socks: WgSocksAppService,
  ) {}

  /** Настройки воркеров ноды на текущую версию; ноды нет — `null`. */
  async build(nodeId: string): Promise<IWgNodeWorkerConfigs | null> {
    const node = await this._nodes.findOne({ where: { id: nodeId } });

    if (!node) return null;

    return {
      state: await this.buildState(node),
      probes: { targets: await this._mesh.probeTargetsFor(node.id) },
      proxies: { proxies: await this._socks.agentConfigs(node.id) },
    };
  }

  /** Желаемое состояние воркера wg на версию ноды. */
  async buildState(node: WgNode): Promise<IWgStateConfig> {
    // Свои интерфейсы и реплики чужих: тот же ключ и пиры.
    const interfaces = await this._interfaceRepo.findForNode(node.id);
    const peersByInterface = await this._peers.serverPeers(
      interfaces.map(iface => iface.id),
    );
    const { tunnels, forwards } = await this._relayTopology(node);

    return {
      version: node.configVersion,
      nodeId: node.id,
      nodeName: node.name,
      interfaces: interfaces.map(iface => ({
        name: iface.name,
        enabled: iface.enabled,
        listenPort: iface.listenPort,
        addressCidr: iface.addressCidr,
        addressV6Cidr: iface.addressV6Cidr,
        privateKey: this._interfaces.privateKeyOf(iface),
        mtu: iface.mtu,
        natEnabled: iface.natEnabled,
        customPostUp: iface.customPostUp,
        customPostDown: iface.customPostDown,
        peers: peersByInterface.get(iface.id) ?? [],
      })),
      tunnels,
      forwards,
    };
  }

  /** Туннели обоих ролей ноды и пробросы, если нода — релей. */
  private async _relayTopology(node: WgNode): Promise<{
    tunnels: IWgWorkerTunnel[];
    forwards: IWgWorkerForward[];
  }> {
    const tunnels: IWgWorkerTunnel[] = [];
    const forwards: IWgWorkerForward[] = [];
    const asRelay = await this._endpoints.linksForRelay(node.id);
    const asTarget = await this._endpoints.linksForTarget(node.id);
    const counterpartIds = [
      ...asRelay.map(link => link.targetNodeId),
      ...asTarget.map(link => link.relayNodeId),
    ];
    const counterparts = new Map(
      (counterpartIds.length
        ? await this._nodes.find({ where: { id: In(counterpartIds) } })
        : []
      ).map(other => [other.id, other]),
    );

    const pushTunnel = (
      tunnelIndex: number,
      remoteHost: string | null | undefined,
      isRelaySide: boolean,
    ): void => {
      if (!remoteHost) {
        logger.warn(
          { nodeId: node.id, tunnelIndex },
          "[WG] tunnel skipped: counterpart has no publicHost",
        );

        return;
      }

      const addresses = relayTunnelAddresses(
        wgConfig.relayTunnelCidr,
        tunnelIndex,
      );

      tunnels.push({
        name: relayTunnelName(tunnelIndex),
        remoteHost,
        localTunnelIp: isRelaySide ? addresses.relayIp : addresses.targetIp,
        remoteTunnelIp: isRelaySide ? addresses.targetIp : addresses.relayIp,
        prefix: addresses.prefix,
        mtu: WG_TUNNEL_MTU,
      });
    };

    for (const link of asRelay) {
      pushTunnel(
        link.tunnelIndex,
        counterparts.get(link.targetNodeId)?.publicHost,
        true,
      );
    }
    for (const link of asTarget) {
      pushTunnel(
        link.tunnelIndex,
        counterparts.get(link.relayNodeId)?.publicHost,
        false,
      );
    }

    // Пробросы на релее: интерфейсы, обслуживаемые его relay-точками.
    const served = await this._interfaceRepo.findServedByRelay(node.id);
    const linkByTarget = new Map(
      asRelay.map(link => [link.targetNodeId, link]),
    );

    for (const iface of served) {
      const endpoint = iface.endpoint!;

      if (endpoint.mode !== EWgEndpointMode.Relay) continue;

      const listenPort = iface.endpointPort ?? iface.listenPort;
      // Копии интерфейса по приоритету (основная — первой); закреплённая —
      // единственный кандидат. Реплика в резерве, только когда её агент
      // отчитался, что интерфейс поднят: нода без агента или с ошибкой
      // интерфейса отвечает на пинг, но трафик там пропал бы. Агент берёт
      // первую живую копию.
      const copies = [
        { nodeId: iface.nodeId, publicHost: iface.node?.publicHost ?? null },
        ...[...(iface.replicas ?? [])]
          .filter(
            replica =>
              replica.status === EWgInterfaceStatus.Up ||
              replica.nodeId === iface.activeReplicaNodeId,
          )
          .sort((a, b) => a.priority - b.priority)
          .map(replica => ({
            nodeId: replica.nodeId,
            publicHost: replica.node?.publicHost ?? null,
          })),
      ].filter(
        copy =>
          !iface.activeReplicaNodeId ||
          copy.nodeId === iface.activeReplicaNodeId,
      );

      type TCandidate = NonNullable<IWgWorkerForward["candidates"]>[number];
      const direct = (copy: (typeof copies)[number]): TCandidate[] =>
        copy.publicHost
          ? [{ targetIp: copy.publicHost, tunnel: null, nodeId: copy.nodeId }]
          : [];
      const tunnel = (copy: (typeof copies)[number]): TCandidate[] => {
        const link = linkByTarget.get(copy.nodeId);

        return link
          ? [
              {
                targetIp: relayTunnelAddresses(
                  wgConfig.relayTunnelCidr,
                  link.tunnelIndex,
                ).targetIp,
                tunnel: relayTunnelName(link.tunnelIndex),
                nodeId: copy.nodeId,
              },
            ]
          : [];
      };
      // IPIP с маршрутом auto: у каждой копии — туннель, затем прямой адрес
      // той же ноды (лёг только туннель — клиенты остаются на ноде); копия
      // целиком недоступна — следующая. DNAT и route=direct — только прямой.
      const candidates = copies.flatMap((copy): TCandidate[] => {
        if (
          endpoint.forwardMode !== EWgForwardMode.Ipip ||
          endpoint.route === EWgEndpointRoute.Direct
        ) {
          return direct(copy);
        }
        if (endpoint.route === EWgEndpointRoute.Tunnel) return tunnel(copy);

        return [...tunnel(copy), ...direct(copy)];
      });

      if (candidates.length === 0) {
        logger.warn(
          { nodeId: node.id, interfaceId: iface.id },
          "[WG] forward skipped: target address unresolved",
        );
        continue;
      }

      forwards.push({
        id: iface.id,
        proto: "udp",
        listenPort,
        targetIp: candidates[0].targetIp,
        targetPort: iface.listenPort,
        ...((candidates.length > 1 || iface.activeReplicaNodeId) && {
          candidates,
        }),
      });
    }

    // Пробросы на внешние сервисы: напрямую или через туннель до цели с
    // аварийным прямым адресом — маршрут выбирает агент по здоровью туннеля.
    for (const forward of await this._forwards.findActiveByRelay(node.id)) {
      const direct =
        forward.targetHost ?? forward.targetNode?.publicHost ?? null;
      const base = {
        id: forward.id,
        proto: forward.protocol,
        listenPort: forward.listenPort,
        targetPort: forward.targetPort,
      };

      if (forward.path === EWgForwardPath.Direct) {
        if (direct) forwards.push({ ...base, targetIp: direct });
        continue;
      }

      const link = forward.targetNodeId
        ? linkByTarget.get(forward.targetNodeId)
        : undefined;

      if (!link) {
        // Линк ещё не создан — пока напрямую, если есть куда.
        if (direct) forwards.push({ ...base, targetIp: direct });
        continue;
      }

      forwards.push({
        ...base,
        targetIp: relayTunnelAddresses(
          wgConfig.relayTunnelCidr,
          link.tunnelIndex,
        ).targetIp,
        fallbackIp: direct,
        route: forward.route,
        tunnel: relayTunnelName(link.tunnelIndex),
      });
    }

    return { tunnels, forwards };
  }
}
