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
import {
  EWgNodeStatus,
  IWgNodeOsInfo,
  WG_NODE_AGENT_ID_MAX,
  WG_NODE_HOST_MAX,
  WG_NODE_NAME_MAX,
} from "./wg-node.types";

/**
 * Нода — VPS с агентом, на котором работают WireGuard-интерфейсы.
 * Желаемая конфигурация версионируется (`configVersion`) и уходит воркеру
 * wg агента настройкой `state`; итог применения даёт `appliedVersion` и
 * фактические статусы.
 */
@Entity("wg_nodes")
@Index("IDX_WG_NODES_NAME", ["name"], { unique: true })
@Index("IDX_WG_NODES_STATUS", ["status"])
@Index("IDX_WG_NODES_OWNER", ["ownerId"])
@Index("IDX_WG_NODES_CREATED_BY", ["createdById"])
@Index("IDX_WG_NODES_AGENT", ["agentId"], {
  unique: true,
  where: "agent_id IS NOT NULL",
})
export class WgNode {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Назначенный владелец; пользователь удалён — владельца нет. */
  @Column({ name: "owner_id", type: "uuid", nullable: true })
  ownerId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "owner_id" })
  owner?: User | null;

  /** Кто создал ноду; пользователь удалён — создателя нет. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  @Column({ type: "varchar", length: WG_NODE_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** Публичный хост ноды (IP/домен) — endpoint клиентов по умолчанию. */
  @Column({
    name: "public_host",
    type: "varchar",
    length: WG_NODE_HOST_MAX,
    nullable: true,
  })
  publicHost!: string | null;

  @Column({ type: "enum", enum: EWgNodeStatus, default: EWgNodeStatus.Created })
  status!: EWgNodeStatus;

  /** Пояснение к статусу: что не так с агентом или воркерами. */
  @Column({ name: "status_message", type: "text", nullable: true })
  statusMessage!: string | null;

  /** Агент ноды (id агента в модуле agent); нет — агент не установлен. */
  @Column({
    name: "agent_id",
    type: "varchar",
    length: WG_NODE_AGENT_ID_MAX,
    nullable: true,
  })
  agentId!: string | null;

  /** Желаемая версия конфигурации; растёт при любом изменении домена. */
  @Column({
    name: "config_version",
    type: "bigint",
    default: 1,
    transformer: bigintNumber,
  })
  configVersion!: number;

  /** Версия, которую воркер wg применил последней. */
  @Column({
    name: "applied_version",
    type: "bigint",
    default: 0,
    transformer: bigintNumber,
  })
  appliedVersion!: number;

  /** Ошибка последнего применения конфигурации (null — успех). */
  @Column({ name: "apply_error", type: "text", nullable: true })
  applyError!: string | null;

  @Column({
    name: "agent_version",
    type: "varchar",
    length: 32,
    nullable: true,
  })
  agentVersion!: string | null;

  @Column({ name: "wg_version", type: "varchar", length: 64, nullable: true })
  wgVersion!: string | null;

  @Column({ name: "os_info", type: "jsonb", nullable: true })
  osInfo!: IWgNodeOsInfo | null;

  /** IP, с которого агент подключился к бэкенду (подсказка для publicHost). */
  @Column({
    name: "agent_remote_ip",
    type: "varchar",
    length: 45,
    nullable: true,
  })
  agentRemoteIp!: string | null;

  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
