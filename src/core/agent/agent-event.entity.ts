import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import { bigintNumber } from "../db";

/** Событие воркера; повтор того же `id` от агента не записывается второй раз. */
@Entity("agent_events")
@Index("IDX_AGENT_EVENTS_RECEIVED", ["receivedAt", "id"])
@Index("IDX_AGENT_EVENTS_AGENT", ["agentId", "receivedAt"])
export class AgentEvent {
  @PrimaryColumn({ name: "agent_id", type: "varchar", length: 32 })
  agentId!: string;

  @PrimaryColumn({ type: "varchar", length: 128 })
  id!: string;

  @Column({ type: "varchar", length: 32 })
  worker!: string;

  @Column({ type: "varchar", length: 64 })
  type!: string;

  @Column({ type: "jsonb", nullable: true })
  data!: unknown;

  /** Замечания проверки `data` по схеме события из манифеста; `null` — подошло. */
  @Column({ type: "jsonb", nullable: true })
  problems!: string[] | null;

  /** Время на узле, мс. */
  @Column({ type: "bigint", transformer: bigintNumber })
  at!: number;

  /** Время приёма, мс. */
  @Column({ name: "received_at", type: "bigint", transformer: bigintNumber })
  receivedAt!: number;
}
