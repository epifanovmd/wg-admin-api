import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

import { bigintNumber } from "../../core/db/transformers";

/** Минутная запись системных метрик ноды (CPU, память, диск, аптайм). */
@Entity("wg_node_metrics")
@Index("IDX_WG_NODE_METRICS_NODE_TS", ["nodeId", "ts"])
@Index("IDX_WG_NODE_METRICS_TS", ["ts"])
export class WgNodeMetric {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @Column({ type: "timestamptz" })
  ts!: Date;

  @Column({ name: "cpu_percent", type: "real" })
  cpuPercent!: number;

  @Column({ name: "load1", type: "real" })
  load1!: number;

  @Column({ name: "mem_used_bytes", type: "bigint", transformer: bigintNumber })
  memUsedBytes!: number;

  @Column({
    name: "mem_total_bytes",
    type: "bigint",
    transformer: bigintNumber,
  })
  memTotalBytes!: number;

  @Column({
    name: "disk_used_bytes",
    type: "bigint",
    transformer: bigintNumber,
  })
  diskUsedBytes!: number;

  @Column({
    name: "disk_total_bytes",
    type: "bigint",
    transformer: bigintNumber,
  })
  diskTotalBytes!: number;

  @Column({ name: "uptime_sec", type: "bigint", transformer: bigintNumber })
  uptimeSec!: number;
}
