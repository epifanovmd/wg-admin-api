import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import { bigintNumber } from "../../../core";

/**
 * Запись агента SDK (`AgentRecord` целиком в `record`: ключ, учёт потока,
 * последние `hello`, `status`, метрики, проблемы). `rev` — версия для
 * условной записи.
 */
@Entity("agents")
@Index("IDX_AGENTS_ENROLLED", ["enrolledAt", "id"])
export class StoredAgent {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "bigint", transformer: bigintNumber })
  rev!: number;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  /** Время регистрации, мс. */
  @Column({ name: "enrolled_at", type: "bigint", transformer: bigintNumber })
  enrolledAt!: number;

  /** Запись SDK (`AgentRecord`) целиком. */
  @Column({ type: "jsonb" })
  record!: object;
}
