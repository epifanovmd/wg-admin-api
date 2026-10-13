import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

import { bigintNumber } from "../db";

/** Точка истории метрик агента: узел (`host`) и метрики воркеров из их пульса (`workers`). */
@Entity("agent_metrics")
@Index("IDX_AGENT_METRICS_AGENT_AT", ["agentId", "at"])
export class AgentMetric {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "agent_id", type: "varchar", length: 32 })
  agentId!: string;

  /** Время сбора на узле, мс. */
  @Column({ type: "bigint", transformer: bigintNumber })
  at!: number;

  @Column({ type: "jsonb", nullable: true })
  host!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  workers!: Record<string, unknown> | null;
}
