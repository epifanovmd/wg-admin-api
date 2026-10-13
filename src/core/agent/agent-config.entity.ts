import { Column, Entity, PrimaryColumn } from "typeorm";

import { bigintNumber } from "../db";

/**
 * Ключ настроек воркера — часть желаемого состояния. Версия только растёт; удалённый ключ
 * остаётся с `data = NULL` (счётчик версии не сбрасывается).
 */
@Entity("agent_configs")
export class AgentConfig {
  @PrimaryColumn({ name: "agent_id", type: "varchar", length: 32 })
  agentId!: string;

  @PrimaryColumn({ type: "varchar", length: 32 })
  worker!: string;

  @PrimaryColumn({ type: "varchar", length: 32 })
  key!: string;

  @Column({ type: "bigint", transformer: bigintNumber })
  version!: number;

  /** Значение (зашифрованное `{ $sealed }` при `AGENT_CONFIGS_KEY`); `NULL` — ключ удалён. */
  @Column({ type: "jsonb", nullable: true })
  data!: unknown;

  /** Кто записал: пользователь или `NULL` (система). */
  @Column({ type: "varchar", length: 255, nullable: true })
  actor!: string | null;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
