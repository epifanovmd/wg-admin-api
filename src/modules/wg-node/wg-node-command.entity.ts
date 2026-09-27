import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { User } from "../user/user.entity";
import { WgNode } from "./wg-node.entity";
import {
  EWgNodeCommandStatus,
  EWgNodeCommandType,
  IWgNodeCommandPayload,
} from "./wg-node.types";

/** Императивная команда агенту (перезапуск интерфейса, журнал, обновление). */
@Entity("wg_node_commands")
@Index("IDX_WG_NODE_COMMANDS_NODE_CREATED", ["nodeId", "createdAt"])
@Index("IDX_WG_NODE_COMMANDS_STATUS", ["status"])
export class WgNodeCommand {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "CASCADE" })
  @JoinColumn({ name: "node_id" })
  node?: WgNode;

  @Column({ type: "enum", enum: EWgNodeCommandType })
  type!: EWgNodeCommandType;

  @Column({
    type: "enum",
    enum: EWgNodeCommandStatus,
    default: EWgNodeCommandStatus.Pending,
  })
  status!: EWgNodeCommandStatus;

  @Column({ type: "jsonb", default: () => "'{}'" })
  payload!: IWgNodeCommandPayload;

  /** Накопленный stdout+stderr; размер ограничен конфигом. */
  @Column({ type: "text", default: "" })
  output!: string;

  @Column({ name: "exit_code", type: "int", nullable: true })
  exitCode!: number | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  /** Кто запросил; пользователь удалён — история остаётся. */
  @Column({ name: "requested_by", type: "uuid", nullable: true })
  requestedBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "requested_by" })
  requestedByUser?: User | null;

  @Column({ name: "timeout_sec", type: "int" })
  timeoutSec!: number;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
