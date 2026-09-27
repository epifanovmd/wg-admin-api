import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { WgNode } from "../wg-node";
import { WgInterface } from "./wg-interface.entity";
import { EWgInterfaceStatus } from "./wg-interface.types";

/**
 * Реплика интерфейса на другой ноде: тот же ключ, адреса и всегда тот же
 * набор пиров. Клиент подходит к любой реплике — релей точки переключает
 * трафик между ними (авто по здоровью или закреплённая вручную).
 */
@Entity("wg_interface_replicas")
@Index("IDX_WG_IFACE_REPLICAS_PAIR", ["interfaceId", "nodeId"], {
  unique: true,
})
export class WgInterfaceReplica {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "interface_id", type: "uuid" })
  interfaceId!: string;

  @ManyToOne(() => WgInterface, iface => iface.replicas, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "interface_id" })
  iface?: WgInterface;

  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "node_id" })
  node?: WgNode;

  /** Порядок перехода в авто-режиме: основная нода — 0, реплики — с 1. */
  @Column({ type: "int" })
  priority!: number;

  @Column({
    type: "enum",
    enum: EWgInterfaceStatus,
    default: EWgInterfaceStatus.Unknown,
  })
  status!: EWgInterfaceStatus;

  @Column({ name: "status_message", type: "text", nullable: true })
  statusMessage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
