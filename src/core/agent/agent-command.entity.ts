import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { IAgentErrorInfo } from "./protocol";

export type TAgentCommandStatus = "pending" | "done";

/**
 * Команда агенту: `seq` — порядок доставки в потоке; ждущие (`pending`) агент получает при
 * каждом подключении с `seq` больше последнего полученного. Итог — `ok`, `result`, `error`.
 */
@Entity("agent_commands")
@Index("IDX_AGENT_COMMANDS_AGENT_PENDING", ["agentId", "status", "seq"])
@Index("IDX_AGENT_COMMANDS_FINISHED", ["finishedAt"])
@Index("IDX_AGENT_COMMANDS_ID", ["id"], { unique: true })
export class AgentCommand {
  @PrimaryGeneratedColumn({ type: "bigint" })
  seq!: string;

  @Column({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "agent_id", type: "varchar", length: 32 })
  agentId!: string;

  @Column({ type: "varchar", length: 64 })
  type!: string;

  @Column({ type: "jsonb", nullable: true })
  args!: unknown;

  /** Для `worker.command` — воркер и тип его команды (поиск, журнал). */
  @Column({ type: "varchar", length: 32, nullable: true })
  worker!: string | null;

  @Column({ name: "worker_type", type: "varchar", length: 64, nullable: true })
  workerType!: string | null;

  @Column({ name: "deadline_at", type: "timestamptz", nullable: true })
  deadlineAt!: Date | null;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: TAgentCommandStatus;

  @Column({ type: "boolean", nullable: true })
  ok!: boolean | null;

  @Column({ type: "jsonb", nullable: true })
  result!: unknown;

  @Column({ type: "jsonb", nullable: true })
  error!: IAgentErrorInfo | null;

  /** Ход долгой команды воркера (0..1) и его текст. */
  @Column({ type: "real", nullable: true })
  progress!: number | null;

  @Column({
    name: "progress_text",
    type: "varchar",
    length: 200,
    nullable: true,
  })
  progressText!: string | null;

  /** Кто отправил: пользователь или `NULL` (система). */
  @Column({ type: "varchar", length: 255, nullable: true })
  actor!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  /** Номер в потоке. */
  get seqNumber(): number {
    return Number(this.seq);
  }
}
