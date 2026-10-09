import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import { bigintNumber } from "../../core";

/**
 * Событие воркера (`POST /events` на сокете агента). Ключ — агент и id
 * сообщения агента: повтор доставки не задваивает событие.
 */
@Entity("agent_events")
@Index("IDX_AGENT_EVENTS_RECEIVED", ["receivedAt", "id"])
@Index("IDX_AGENT_EVENTS_AGENT_RECEIVED", ["agentId", "receivedAt"])
export class AgentWorkerEvent {
  @PrimaryColumn({ name: "agent_id", type: "varchar", length: 64 })
  agentId!: string;

  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "varchar", length: 32 })
  worker!: string;

  @Column({ type: "varchar", length: 64 })
  type!: string;

  @Column({ type: "jsonb", nullable: true })
  data!: unknown;

  /** Замечания проверки `data` по схеме манифеста; `null` — подошло или не проверялось. */
  @Column({ type: "jsonb", nullable: true })
  problems!: string[] | null;

  /** Когда случилось на узле, мс. */
  @Column({ type: "bigint", transformer: bigintNumber })
  at!: number;

  /** Когда принято сервером, мс. */
  @Column({ name: "received_at", type: "bigint", transformer: bigintNumber })
  receivedAt!: number;
}
