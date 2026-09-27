import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

import { bigintNumber } from "../../core/db/transformers";

/** Часовой агрегат статистики пира (rollup из `wg_stat_samples`). */
@Entity("wg_stat_hours")
@Index("IDX_WG_STAT_HOURS_PEER_TS", ["peerId", "ts"])
@Index("IDX_WG_STAT_HOURS_IFACE_TS", ["interfaceId", "ts"])
@Index("IDX_WG_STAT_HOURS_NODE_TS", ["nodeId", "ts"])
@Index("IDX_WG_STAT_HOURS_TS", ["ts"])
export class WgStatHour {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "peer_id", type: "uuid" })
  peerId!: string;

  @Column({ name: "interface_id", type: "uuid" })
  interfaceId!: string;

  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  /** Начало часа. */
  @Column({ type: "timestamptz" })
  ts!: Date;

  @Column({ name: "rx_delta", type: "bigint", transformer: bigintNumber })
  rxDelta!: number;

  @Column({ name: "tx_delta", type: "bigint", transformer: bigintNumber })
  txDelta!: number;

  @Column({ name: "rx_peak_bps", type: "bigint", transformer: bigintNumber })
  rxPeakBps!: number;

  @Column({ name: "tx_peak_bps", type: "bigint", transformer: bigintNumber })
  txPeakBps!: number;

  /** Доля времени онлайн в часе (0..1). */
  @Column({ name: "online_ratio", type: "real" })
  onlineRatio!: number;
}
