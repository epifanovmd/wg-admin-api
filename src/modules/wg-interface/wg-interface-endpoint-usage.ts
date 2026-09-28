import { inject } from "inversify";

import { Injectable } from "../../core";
import type { IWgEndpointInterfaceDto, IWgEndpointUsage } from "../wg-endpoint";
import { WgNodeService } from "../wg-node";
import { WgInterfaceRepository } from "./wg-interface.repository";

/** Ноды интерфейсов, подключённых через точку, — для проверок wg-endpoint. */
@Injectable()
export class WgInterfaceEndpointUsage implements IWgEndpointUsage {
  constructor(
    @inject(WgInterfaceRepository)
    private readonly _repo: WgInterfaceRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
  ) {}

  async targetNodeIds(endpointId: string): Promise<string[]> {
    const interfaces = await this._repo.findByEndpoint(endpointId);

    return [
      ...new Set(
        interfaces.flatMap(iface => [
          iface.nodeId,
          ...(iface.replicas ?? []).map(replica => replica.nodeId),
        ]),
      ),
    ];
  }

  async interfacesByEndpoint(
    endpointIds: string[],
  ): Promise<Record<string, IWgEndpointInterfaceDto[]>> {
    const result: Record<string, IWgEndpointInterfaceDto[]> = {};

    for (const iface of await this._repo.findByEndpoints(endpointIds)) {
      if (!iface.endpointId) continue;

      (result[iface.endpointId] ??= []).push({
        interfaceId: iface.id,
        interfaceName: iface.name,
        nodeId: iface.nodeId,
        nodeName: iface.node?.name ?? null,
        port: iface.endpointPort ?? iface.listenPort,
        copyNodeIds: (iface.replicas ?? []).map(replica => replica.nodeId),
      });
    }

    return result;
  }

  async relayPortConflict(
    endpointId: string,
    relayNodeId: string,
  ): Promise<boolean> {
    const relay = await this._nodes.findEntity(relayNodeId);
    const hostPorts = relay.osInfo?.udpPorts ?? [];

    for (const iface of await this._repo.findByEndpoint(endpointId)) {
      const port = iface.endpointPort ?? iface.listenPort;

      if (
        hostPorts.includes(port) ||
        (await this._repo.nodeListenPortInUse(relayNodeId, port)) ||
        (await this._repo.relayForwardPortInUse(relayNodeId, port, {
          endpointId,
        }))
      ) {
        return true;
      }
    }

    return false;
  }
}
