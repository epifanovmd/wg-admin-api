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
  EWgEndpointMode,
  EWgForwardMode,
  WG_ENDPOINT_NAME_MAX,
} from "./wg-endpoint.types";

/**
 * Точка подключения — стабильный адрес, который получают клиенты в конфиге.
 * Отвязывает адрес в клиентских конфигах от адреса ноды: ноду можно менять,
 * не перевыпуская конфиги. В режиме `relay` адрес обслуживает релей-нода,
 * агент которой пробрасывает UDP до целевой ноды (DNAT или IPIP).
 */
@Entity("wg_endpoints")
@Index("IDX_WG_ENDPOINTS_NAME", ["name"], { unique: true })
export class WgEndpoint {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: WG_ENDPOINT_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** Хост (IP/домен), который попадает в клиентские конфиги. */
  @Column({ type: "varchar", length: 255 })
  host!: string;

  @Column({ type: "enum", enum: EWgEndpointMode })
  mode!: EWgEndpointMode;

  /** Релей-нода (только для mode=relay); удаление ноды блокируется. */
  @Column({ name: "relay_node_id", type: "uuid", nullable: true })
  relayNodeId!: string | null;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "relay_node_id" })
  relayNode?: WgNode | null;

  @Column({
    name: "forward_mode",
    type: "enum",
    enum: EWgForwardMode,
    default: EWgForwardMode.Dnat,
  })
  forwardMode!: EWgForwardMode;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
