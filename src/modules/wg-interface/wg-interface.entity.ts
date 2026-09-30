import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "../user/user.entity";
import { WgEndpoint } from "../wg-endpoint";
import { WgNode } from "../wg-node";
import {
  EWgInterfaceStatus,
  WG_IFACE_DNS_MAX,
  WG_IFACE_NAME_MAX,
} from "./wg-interface.types";
import { WgInterfaceReplica } from "./wg-interface-replica.entity";

/**
 * WireGuard-интерфейс на ноде. Желаемое состояние — в БД (ключи шифруются),
 * фактическое (`status`) сообщает агент. Адрес подключения клиентов задаёт
 * точка подключения (`endpointId`), иначе — publicHost ноды.
 */
@Entity("wg_interfaces")
@Index("IDX_WG_INTERFACES_NODE_NAME", ["nodeId", "name"], { unique: true })
@Index("IDX_WG_INTERFACES_NODE_PORT", ["nodeId", "listenPort"], {
  unique: true,
})
@Index("IDX_WG_INTERFACES_OWNER", ["ownerId"])
@Index("IDX_WG_INTERFACES_CREATED_BY", ["createdById"])
export class WgInterface {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Назначенный владелец; пользователь удалён — владельца нет. */
  @Column({ name: "owner_id", type: "uuid", nullable: true })
  ownerId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "owner_id" })
  owner?: User | null;

  /** Кто создал интерфейс; пользователь удалён — создателя нет. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  /** Нода интерфейса; удаление ноды с интерфейсами блокируется. */
  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "node_id" })
  node?: WgNode;

  @Column({ type: "varchar", length: WG_IFACE_NAME_MAX })
  name!: string;

  @Column({ name: "listen_port", type: "int" })
  listenPort!: number;

  /** Адрес интерфейса с маской подсети пиров, например `10.0.0.1/24`. */
  @Column({ name: "address_cidr", type: "varchar", length: 43 })
  addressCidr!: string;

  /** IPv6-адрес интерфейса (опционально), например `fd00:10::1/64`. */
  @Column({
    name: "address_v6_cidr",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  addressV6Cidr!: string | null;

  /** Приватный ключ интерфейса, зашифрован `WgSecretBox`. */
  @Column({ name: "private_key_enc", type: "text" })
  privateKeyEnc!: string;

  @Column({ name: "public_key", type: "varchar", length: 64 })
  publicKey!: string;

  /** DNS для клиентов по умолчанию (список через запятую). */
  @Column({ type: "varchar", length: WG_IFACE_DNS_MAX, nullable: true })
  dns!: string | null;

  @Column({ type: "int", nullable: true })
  mtu!: number | null;

  /** Точка подключения клиентов; удаление используемой точки блокируется. */
  @Column({ name: "endpoint_id", type: "uuid", nullable: true })
  endpointId!: string | null;

  @ManyToOne(() => WgEndpoint, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "endpoint_id" })
  endpoint?: WgEndpoint | null;

  /** Порт на точке подключения (по умолчанию `listenPort`). */
  @Column({ name: "endpoint_port", type: "int", nullable: true })
  endpointPort!: number | null;

  /** Пресет NAT: masquerade исходящего трафика пиров (PostUp/PostDown). */
  @Column({ name: "nat_enabled", type: "boolean", default: true })
  natEnabled!: boolean;

  /** Произвольные хуки — только с правом `wg:interface:hooks`. */
  @Column({ name: "custom_post_up", type: "text", nullable: true })
  customPostUp!: string | null;

  @Column({ name: "custom_post_down", type: "text", nullable: true })
  customPostDown!: string | null;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  /**
   * Реплика, закреплённая вручную для трафика через релей (основная нода или
   * нода реплики); null — авто: основная, при недоступности — следующая.
   */
  @Column({ name: "active_replica_node_id", type: "uuid", nullable: true })
  activeReplicaNodeId!: string | null;

  /** Копия, через которую релей сейчас шлёт трафик (по отчёту агента). */
  @Column({ name: "serving_node_id", type: "uuid", nullable: true })
  servingNodeId!: string | null;

  @OneToMany(() => WgInterfaceReplica, replica => replica.iface)
  replicas?: WgInterfaceReplica[];

  @Column({
    type: "enum",
    enum: EWgInterfaceStatus,
    default: EWgInterfaceStatus.Unknown,
  })
  status!: EWgInterfaceStatus;

  /** Причина ошибки применения (сообщает агент). */
  @Column({ name: "status_message", type: "text", nullable: true })
  statusMessage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
