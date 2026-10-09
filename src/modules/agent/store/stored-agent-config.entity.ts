import { Column, Entity, PrimaryColumn } from "typeorm";

import { bigintNumber } from "../../../core";

/**
 * Настройки воркера на агенте: строка на ключ. Версия — счётчик ключа: после
 * удаления строка остаётся с `data = NULL`, и следующая запись получает
 * версию выше прежней.
 */
@Entity("agent_configs")
export class StoredAgentConfig {
  @PrimaryColumn({ name: "agent_id", type: "varchar", length: 64 })
  agentId!: string;

  @PrimaryColumn({ type: "varchar", length: 32 })
  worker!: string;

  @PrimaryColumn({ type: "varchar", length: 32 })
  key!: string;

  @Column({ type: "bigint", transformer: bigintNumber })
  version!: number;

  /** Значение (JSON); `NULL` — ключ удалён. */
  @Column({ type: "jsonb", nullable: true })
  data!: unknown;

  /** Время записи, мс. */
  @Column({ name: "updated_at", type: "bigint", transformer: bigintNumber })
  updatedAt!: number;

  /** Кто изменил (`agents.by`). */
  @Column({ type: "varchar", length: 255, nullable: true })
  actor!: string | null;
}
