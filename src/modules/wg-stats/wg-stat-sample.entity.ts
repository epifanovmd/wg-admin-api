import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

import { bigintNumber } from "../../core/db/transformers";

/**
 * Минутный сэмпл статистики пира (deadband: при простое пишется реже).
 * Ссылки денормализованы и без FK: история переживает удаление пира,
 * интерфейса и пользователя; чистится retention-задачей.
 */
@Entity("wg_stat_samples")
@Index("IDX_WG_STAT_SAMPLES_PEER_TS", ["peerId", "ts"])
@Index("IDX_WG_STAT_SAMPLES_IFACE_TS", ["interfaceId", "ts"])
@Index("IDX_WG_STAT_SAMPLES_NODE_TS", ["nodeId", "ts"])
@Index("IDX_WG_STAT_SAMPLES_TS", ["ts"])
export class WgStatSample {
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

  @Column({ type: "timestamptz" })
  ts!: Date;

  /** Накопленный трафик пира (монотонный). */
  @Column({ name: "rx_total", type: "bigint", transformer: bigintNumber })
  rxTotal!: number;

  @Column({ name: "tx_total", type: "bigint", transformer: bigintNumber })
  txTotal!: number;

  /** Трафик с прошлой записи. */
  @Column({ name: "rx_delta", type: "bigint", transformer: bigintNumber })
  rxDelta!: number;

  @Column({ name: "tx_delta", type: "bigint", transformer: bigintNumber })
  txDelta!: number;

  /** Пиковая мгновенная скорость в окне записи. */
  @Column({ name: "rx_peak_bps", type: "bigint", transformer: bigintNumber })
  rxPeakBps!: number;

  @Column({ name: "tx_peak_bps", type: "bigint", transformer: bigintNumber })
  txPeakBps!: number;

  @Column({ type: "boolean" })
  online!: boolean;
}
