import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { bigintNumber } from "../../core/db/transformers";
import { User } from "../user/user.entity";
import { WgInterface } from "../wg-interface";
import { EWgPeerDisabledReason, WG_PEER_NAME_MAX } from "./wg-peer.types";

/**
 * Пир WireGuard-интерфейса. Приватный ключ и PSK хранятся зашифрованными,
 * чтобы в любой момент заново создать клиентский конфиг и QR; пир, созданный
 * импортом публичного ключа, приватного ключа не имеет.
 */
@Entity("wg_peers")
@Index("IDX_WG_PEERS_IFACE_NAME", ["interfaceId", "name"], { unique: true })
@Index("IDX_WG_PEERS_IFACE_PUBKEY", ["interfaceId", "publicKey"], {
  unique: true,
})
@Index("IDX_WG_PEERS_IFACE_ADDRESS", ["interfaceId", "addressV4"], {
  unique: true,
})
@Index("IDX_WG_PEERS_USER", ["userId"])
@Index("IDX_WG_PEERS_CREATED_BY", ["createdById"])
export class WgPeer {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Интерфейс пира; удаление интерфейса с пирами блокируется. */
  @Column({ name: "interface_id", type: "uuid" })
  interfaceId!: string;

  @ManyToOne(() => WgInterface, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "interface_id" })
  iface?: WgInterface;

  /** Держатель пира; пользователь удалён — пир остаётся без держателя. */
  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  /** Кто создал пира; пользователь удалён — создателя нет. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  @Column({ type: "varchar", length: WG_PEER_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "public_key", type: "varchar", length: 64 })
  publicKey!: string;

  /** Приватный ключ клиента, зашифрован; null — пир импортирован по pubkey. */
  @Column({ name: "private_key_enc", type: "text", nullable: true })
  privateKeyEnc!: string | null;

  @Column({ name: "preshared_key_enc", type: "text", nullable: true })
  presharedKeyEnc!: string | null;

  /** IPv4-адрес пира (без маски; в конфиг попадает как /32). */
  @Column({ name: "address_v4", type: "varchar", length: 15 })
  addressV4!: string;

  @Column({ name: "address_v6", type: "varchar", length: 45, nullable: true })
  addressV6!: string | null;

  /** AllowedIPs клиента (split tunnel), список CIDR через запятую. */
  @Column({ name: "client_allowed_ips", type: "varchar", length: 500 })
  clientAllowedIPs!: string;

  @Column({ name: "client_dns", type: "varchar", length: 255, nullable: true })
  clientDns!: string | null;

  @Column({ name: "client_mtu", type: "int", nullable: true })
  clientMtu!: number | null;

  @Column({ name: "persistent_keepalive", type: "int", default: 25 })
  persistentKeepalive!: number;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({
    name: "disabled_reason",
    type: "enum",
    enum: EWgPeerDisabledReason,
    nullable: true,
  })
  disabledReason!: EWgPeerDisabledReason | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "last_handshake_at", type: "timestamptz", nullable: true })
  lastHandshakeAt!: Date | null;

  /** Последний адрес клиента (`ip:port`), из статистики. */
  @Column({
    name: "last_endpoint",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  lastEndpoint!: string | null;

  /** Накопленный трафик пира (монотонный, с компенсацией сбросов). */
  @Column({
    name: "rx_bytes_total",
    type: "bigint",
    default: 0,
    transformer: bigintNumber,
  })
  rxBytesTotal!: number;

  @Column({
    name: "tx_bytes_total",
    type: "bigint",
    default: 0,
    transformer: bigintNumber,
  })
  txBytesTotal!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
