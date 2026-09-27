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

/**
 * Линк релей-ноды с целевой нодой: выделенный /30-блок для IPIP-туннеля.
 * Создаётся, когда интерфейс целевой ноды начинает использовать relay-точку,
 * и удаляется, когда таких интерфейсов не остаётся.
 */
@Entity("wg_relay_links")
@Index("IDX_WG_RELAY_LINKS_PAIR", ["relayNodeId", "targetNodeId"], {
  unique: true,
})
@Index("IDX_WG_RELAY_LINKS_TUNNEL", ["tunnelIndex"], { unique: true })
export class WgRelayLink {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "relay_node_id", type: "uuid" })
  relayNodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "CASCADE" })
  @JoinColumn({ name: "relay_node_id" })
  relayNode?: WgNode;

  @Column({ name: "target_node_id", type: "uuid" })
  targetNodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "CASCADE" })
  @JoinColumn({ name: "target_node_id" })
  targetNode?: WgNode;

  /** Индекс /30-блока в `WG_RELAY_TUNNEL_CIDR`; имя туннеля `wgt<index>`. */
  @Column({ name: "tunnel_index", type: "int" })
  tunnelIndex!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
