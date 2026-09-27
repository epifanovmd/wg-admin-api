import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { WgNode } from "../wg-node";
import {
  EWgForwardPath,
  EWgForwardProtocol,
  EWgForwardRoute,
  WG_FORWARD_HOST_MAX,
  WG_FORWARD_NAME_MAX,
} from "./wg-forward.types";

/**
 * Проброс порта на релее до внешнего сервиса: WireGuard-сервер или
 * SOCKS/TLS-прокси, которыми wg-admin не управляет. Цель — нода с агентом
 * (для пути `ipip` она держит свой конец туннеля) или просто адрес.
 */
@Entity("wg_forwards")
@Index("IDX_WG_FORWARDS_NAME", ["name"], { unique: true })
@Index(
  "IDX_WG_FORWARDS_RELAY_PORT",
  ["relayNodeId", "protocol", "listenPort"],
  {
    unique: true,
  },
)
export class WgForward {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: WG_FORWARD_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "relay_node_id", type: "uuid" })
  relayNodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "relay_node_id" })
  relayNode?: WgNode;

  @Column({ type: "enum", enum: EWgForwardProtocol })
  protocol!: EWgForwardProtocol;

  @Column({ name: "listen_port", type: "int" })
  listenPort!: number;

  /** Цель с агентом; для пути `ipip` обязательна. */
  @Column({ name: "target_node_id", type: "uuid", nullable: true })
  targetNodeId!: string | null;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "target_node_id" })
  targetNode?: WgNode | null;

  /**
   * Прямой адрес цели: для `direct` — куда слать, для `ipip` — аварийный
   * путь мимо туннеля. Пусто — publicHost ноды-цели.
   */
  @Column({
    name: "target_host",
    type: "varchar",
    length: WG_FORWARD_HOST_MAX,
    nullable: true,
  })
  targetHost!: string | null;

  @Column({ name: "target_port", type: "int" })
  targetPort!: number;

  @Column({ type: "enum", enum: EWgForwardPath })
  path!: EWgForwardPath;

  @Column({
    type: "enum",
    enum: EWgForwardRoute,
    default: EWgForwardRoute.Auto,
  })
  route!: EWgForwardRoute;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
