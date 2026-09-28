import { BaseDto } from "../../../core";
import type { EWgEndpointMode } from "../../wg-endpoint";
import type { EWgNodeStatus } from "../../wg-node";
import type { WgInterface } from "../wg-interface.entity";
import type { EWgInterfaceStatus } from "../wg-interface.types";

/** Адрес подключения клиентов: точка подключения, иначе publicHost ноды. */
export const resolveClientEndpoint = (iface: WgInterface): string | null => {
  if (iface.endpoint) {
    return `${iface.endpoint.host}:${iface.endpointPort ?? iface.listenPort}`;
  }
  if (iface.node?.publicHost) {
    return `${iface.node.publicHost}:${iface.listenPort}`;
  }

  return null;
};

/** Копия интерфейса на другой ноде. */
export interface IWgInterfaceReplicaDto {
  nodeId: string;
  nodeName: string | null;
  /** Статус ноды копии: `created` — агента ещё нет, копия ждёт его. */
  nodeStatus: EWgNodeStatus | null;
  priority: number;
  status: EWgInterfaceStatus;
  statusMessage: string | null;
}

/** Точка подключения интерфейса: через что к нему приходят клиенты. */
export interface IWgInterfaceEndpointDto {
  name: string;
  /** `relay` — трафик пересылает релей панели и переключает на копии. */
  mode: EWgEndpointMode;
  relayNodeId: string | null;
  relayNodeName: string | null;
}

export class WgInterfaceDto extends BaseDto {
  id: string;
  nodeId: string;
  /** Название ноды (если загружена связь). */
  nodeName: string | null;
  /** Статус ноды (если загружена связь): `created` — агента ещё нет. */
  nodeStatus: EWgNodeStatus | null;
  name: string;
  listenPort: number;
  addressCidr: string;
  addressV6Cidr: string | null;
  publicKey: string;
  dns: string | null;
  mtu: number | null;
  endpointId: string | null;
  /** Точка подключения (если загружена связь). */
  endpoint: IWgInterfaceEndpointDto | null;
  endpointPort: number | null;
  /** Итоговый `host:port` для клиентских конфигов. */
  clientEndpoint: string | null;
  natEnabled: boolean;
  customPostUp: string | null;
  customPostDown: string | null;
  enabled: boolean;
  status: EWgInterfaceStatus;
  statusMessage: string | null;
  /** Копии на других нодах (тот же ключ и пиры), по приоритету. */
  replicas: IWgInterfaceReplicaDto[];
  /** Закреплённая для трафика через релей копия; null — авто. */
  activeReplicaNodeId: string | null;
  /** Копия, через которую релей шлёт трафик сейчас (по отчёту агента). */
  servingNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgInterface) {
    super(entity);

    this.id = entity.id;
    this.nodeId = entity.nodeId;
    this.nodeName = entity.node?.name ?? null;
    this.nodeStatus = entity.node?.status ?? null;
    this.name = entity.name;
    this.listenPort = entity.listenPort;
    this.addressCidr = entity.addressCidr;
    this.addressV6Cidr = entity.addressV6Cidr;
    this.publicKey = entity.publicKey;
    this.dns = entity.dns;
    this.mtu = entity.mtu;
    this.endpointId = entity.endpointId;
    this.endpoint = entity.endpoint
      ? {
          name: entity.endpoint.name,
          mode: entity.endpoint.mode,
          relayNodeId: entity.endpoint.relayNodeId,
          relayNodeName: entity.endpoint.relayNode?.name ?? null,
        }
      : null;
    this.endpointPort = entity.endpointPort;
    this.clientEndpoint = resolveClientEndpoint(entity);
    this.natEnabled = entity.natEnabled;
    this.customPostUp = entity.customPostUp;
    this.customPostDown = entity.customPostDown;
    this.enabled = entity.enabled;
    this.status = entity.status;
    this.statusMessage = entity.statusMessage;
    this.replicas = (entity.replicas ?? [])
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map(replica => ({
        nodeId: replica.nodeId,
        nodeName: replica.node?.name ?? null,
        nodeStatus: replica.node?.status ?? null,
        priority: replica.priority,
        status: replica.status,
        statusMessage: replica.statusMessage,
      }));
    this.activeReplicaNodeId = entity.activeReplicaNodeId;
    this.servingNodeId = entity.servingNodeId;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: WgInterface) {
    return new WgInterfaceDto(entity);
  }
}

/** Краткая запись для выпадающих списков. */
export class WgInterfaceOptionDto extends BaseDto {
  id: string;
  name: string;
  nodeId: string;
  nodeName: string | null;
  addressCidr: string;

  constructor(entity: WgInterface) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.nodeId = entity.nodeId;
    this.nodeName = entity.node?.name ?? null;
    this.addressCidr = entity.addressCidr;
  }

  static fromEntity(entity: WgInterface) {
    return new WgInterfaceOptionDto(entity);
  }
}
