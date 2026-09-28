import { inject } from "inversify";
import { In } from "typeorm";

import { Injectable, logger } from "../../core";
import {
  EWgEndpointMode,
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
import {
  wgConfig,
  WgNode,
  WgNodeCommandService,
  WgNodeRepository,
} from "../wg-node";
import { WgPeerService } from "../wg-peer";
import { WgSocksAppService } from "../wg-socks";
import { WgMeshService } from "../wg-stats";
import {
  IWgAgentDesiredState,
  IWgAgentForward,
  IWgAgentTunnel,
  WG_AGENT_STATS_INTERVAL_MS,
  WG_AGENT_TUNNEL_MTU,
} from "./wg-agent-protocol";
import { WgNodeSignals } from "./wg-node-signals";

/** Опрос без LISTEN (PgBouncer, обрыв соединения). */
const POLL_TICK_MS = 1000;
/** Страховочная перепроверка при работающем LISTEN. */
const SIGNAL_SAFETY_MS = 10_000;

/** Сборка желаемого состояния ноды и long-poll ожидание изменений. */
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
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
    @inject(WgNodeSignals) private readonly _signals: WgNodeSignals,
    @inject(WgMeshService) private readonly _mesh: WgMeshService,
    @inject(WgForwardRepository)
    private readonly _forwards: WgForwardRepository,
    @inject(WgSocksAppService) private readonly _socks: WgSocksAppService,
  ) {}

  /**
   * Ждать изменения (новая версия конфигурации или невыполненные команды)
   * до `waitMs`, затем вернуть текущее желаемое состояние.
   */
  async waitAndBuild(
    node: WgNode,
    knownVersion: number,
    waitMs: number,
  ): Promise<IWgAgentDesiredState> {
    const deadline =
      Date.now() + Math.min(Math.max(waitMs, 0), wgConfig.agentPollWaitMs);
    let currentVersion = node.configVersion;

    for (;;) {
      const pending = await this._commands.pendingForAgent(node.id);

      if (
        currentVersion !== knownVersion ||
        pending.length > 0 ||
        Date.now() >= deadline
      ) {
        return this._build(node, currentVersion, pending);
      }

      // Будит NOTIFY триггера (после коммита); без LISTEN — опрос.
      await this._signals.waitForNode(
        node.id,
        Math.min(
          deadline - Date.now(),
          this._signals.isListening ? SIGNAL_SAFETY_MS : POLL_TICK_MS,
        ),
      );

      const fresh = await this._nodes.findOne({
        where: { id: node.id },
        select: { id: true, configVersion: true },
      });

      currentVersion = fresh?.configVersion ?? currentVersion;
    }
  }

  /**
   * Актуальное состояние ноды без ожидания: версия конфигурации и
   * невыполненные команды — на момент вызова (канал постоянной связи).
   */
  async buildCurrent(nodeId: string): Promise<IWgAgentDesiredState | null> {
    const node = await this._nodes.findOne({ where: { id: nodeId } });

    if (!node) return null;

    return this._build(
      node,
      node.configVersion,
      await this._commands.pendingForAgent(node.id),
    );
  }

  private async _build(
    node: WgNode,
    version: number,
    pending: Awaited<ReturnType<WgNodeCommandService["pendingForAgent"]>>,
  ): Promise<IWgAgentDesiredState> {
    // Свои интерфейсы и реплики чужих: тот же ключ и пиры.
    const interfaces = await this._interfaceRepo.findForNode(node.id);
    const peersByInterface = await this._peers.serverPeers(
      interfaces.map(iface => iface.id),
    );
    const { tunnels, forwards } = await this._relayTopology(node);

    return {
      version,
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
      probeTargets: await this._mesh.probeTargetsFor(node.id),
      socks: await this._socks.agentConfigs(node.id),
      commands: pending.map(command => ({
        id: command.id,
        type: command.type,
        payload: command.payload,
        timeoutSec: command.timeoutSec,
      })),
      settings: {
        statsIntervalMs: WG_AGENT_STATS_INTERVAL_MS,
      },
    };
  }

  /** Туннели обоих ролей ноды и пробросы, если нода — релей. */
  private async _relayTopology(node: WgNode): Promise<{
    tunnels: IWgAgentTunnel[];
    forwards: IWgAgentForward[];
  }> {
    const tunnels: IWgAgentTunnel[] = [];
    const forwards: IWgAgentForward[] = [];
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
        mtu: WG_AGENT_TUNNEL_MTU,
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

      type TCandidate = NonNullable<IWgAgentForward["candidates"]>[number];
      const candidates = copies.flatMap((copy): TCandidate[] => {
        if (endpoint.forwardMode !== EWgForwardMode.Ipip) {
          return copy.publicHost
            ? [{ targetIp: copy.publicHost, tunnel: null, nodeId: copy.nodeId }]
            : [];
        }

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
