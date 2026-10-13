import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { bigintNumber } from "../db";
import type {
  IAgentHello,
  IAgentHost,
  IAgentMetrics,
  IAgentState,
  IAgentWatch,
} from "./protocol";

/**
 * Агент: ключ (хеш секрета), что он сообщил о себе (hello, состояние, последние метрики),
 * желаемое (`desiredRev`, наблюдение) и связь (поток, последний запрос).
 */
@Entity("agents")
@Index("IDX_AGENTS_ENROLLED", ["enrolledAt"])
export class Agent {
  /** 32 hex — выдаёт сервер при регистрации. */
  @PrimaryColumn({ type: "varchar", length: 32 })
  id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  /** Метки: из токена регистрации (сервер) поверх присланных агентом. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  labels!: Record<string, string>;

  /** Метки токена регистрации: важнее присланных агентом, агент их не меняет. */
  @Column({ name: "token_labels", type: "jsonb", default: () => "'{}'" })
  tokenLabels!: Record<string, string>;

  /** sha256 секрета, hex. */
  @Column({ name: "secret_hash", type: "varchar", length: 64 })
  secretHash!: string;

  /** sha256 нового секрета после `agent.rotateKey`, пока агент им не вошёл. */
  @Column({
    name: "pending_secret_hash",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  pendingSecretHash!: string | null;

  @Column({ type: "jsonb", nullable: true })
  host!: IAgentHost | null;

  @Column({ type: "jsonb", nullable: true })
  hello!: IAgentHello | null;

  @Column({ type: "jsonb", nullable: true })
  state!: IAgentState | null;

  @Column({ name: "metrics", type: "jsonb", nullable: true })
  metrics!: IAgentMetrics | null;

  /** Номер желаемого: растёт при любом изменении настроек воркеров и наблюдения. */
  @Column({
    name: "desired_rev",
    type: "bigint",
    transformer: bigintNumber,
    default: 1,
  })
  desiredRev!: number;

  @Column({ type: "jsonb", nullable: true })
  watch!: IAgentWatch | null;

  /** Копия API, у которой открыт поток агента; `NULL` — потока нет. */
  @Column({
    name: "stream_instance",
    type: "varchar",
    length: 128,
    nullable: true,
  })
  streamInstance!: string | null;

  /** Последний запрос агента (поток, опрос, отправка). */
  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  /** IP, с которого пришёл последний запрос. */
  @Column({ name: "remote_ip", type: "varchar", length: 64, nullable: true })
  remoteIp!: string | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  /**
   * Агент удалён: отозван, его история удалена; запись остаётся, чтобы агент со старым ключом
   * получал `403 AGENT_REVOKED`, а не регистрировался заново.
   */
  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  /** Токен, которым агент зарегистрирован (`NULL` — общий токен окружения). */
  @Column({ name: "enroll_token_id", type: "uuid", nullable: true })
  enrollTokenId!: string | null;

  @CreateDateColumn({ name: "enrolled_at", type: "timestamptz" })
  enrolledAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
