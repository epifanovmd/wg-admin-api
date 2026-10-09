import { BaseDto } from "../../../core";
import { userDisplayName } from "../../user/user-name";
import type { WgPeer } from "../wg-peer.entity";
import type { EWgPeerDisabledReason } from "../wg-peer.types";
import { isPeerOnline } from "../wg-peer.types";

export class WgPeerDto extends BaseDto {
  id: string;
  interfaceId: string;
  interfaceName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  /** Держатель пира. */
  userId: string | null;
  /** Отображаемое имя держателя. */
  userName: string | null;
  /** Создатель пира. */
  createdById: string | null;
  /** Отображаемое имя создателя. */
  createdByName: string | null;
  name: string;
  description: string | null;
  publicKey: string;
  /** Можно ли получить конфиг/QR (приватный ключ хранится). */
  hasPrivateKey: boolean;
  hasPresharedKey: boolean;
  addressV4: string;
  addressV6: string | null;
  clientAllowedIPs: string;
  clientDns: string | null;
  clientMtu: number | null;
  persistentKeepalive: number;
  enabled: boolean;
  disabledReason: EWgPeerDisabledReason | null;
  expiresAt: Date | null;
  lastHandshakeAt: Date | null;
  lastEndpoint: string | null;
  /** Handshake свежее 3 минут. */
  isOnline: boolean;
  rxBytesTotal: number;
  txBytesTotal: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgPeer) {
    super(entity);

    this.id = entity.id;
    this.interfaceId = entity.interfaceId;
    this.interfaceName = entity.iface?.name ?? null;
    this.nodeId = entity.iface?.nodeId ?? null;
    this.nodeName = entity.iface?.node?.name ?? null;
    this.userId = entity.userId;
    this.userName = userDisplayName(entity.user);
    this.createdById = entity.createdById;
    this.createdByName = userDisplayName(entity.createdBy);
    this.name = entity.name;
    this.description = entity.description;
    this.publicKey = entity.publicKey;
    this.hasPrivateKey = entity.privateKeyEnc !== null;
    this.hasPresharedKey = entity.presharedKeyEnc !== null;
    this.addressV4 = entity.addressV4;
    this.addressV6 = entity.addressV6;
    this.clientAllowedIPs = entity.clientAllowedIPs;
    this.clientDns = entity.clientDns;
    this.clientMtu = entity.clientMtu;
    this.persistentKeepalive = entity.persistentKeepalive;
    this.enabled = entity.enabled;
    this.disabledReason = entity.disabledReason;
    this.expiresAt = entity.expiresAt;
    this.lastHandshakeAt = entity.lastHandshakeAt;
    this.lastEndpoint = entity.lastEndpoint;
    this.isOnline = isPeerOnline(entity.lastHandshakeAt);
    this.rxBytesTotal = entity.rxBytesTotal;
    this.txBytesTotal = entity.txBytesTotal;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: WgPeer) {
    return new WgPeerDto(entity);
  }
}

/** Краткая запись для выпадающих списков. */
export class WgPeerOptionDto extends BaseDto {
  id: string;
  name: string;
  interfaceId: string;
  addressV4: string;

  constructor(entity: WgPeer) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.interfaceId = entity.interfaceId;
    this.addressV4 = entity.addressV4;
  }

  static fromEntity(entity: WgPeer) {
    return new WgPeerOptionDto(entity);
  }
}

/** QR-код клиентского конфига. */
export interface IWgPeerQrDto {
  /** PNG data-URL. */
  dataUrl: string;
}
