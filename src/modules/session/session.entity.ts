import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { TOKEN_HASH_LENGTH } from "../../core/auth/token-hash";
import { User } from "../user/user.entity";

/**
 * Сессия устройства. Refresh-токен хранится только sha256-хешем; при каждом
 * обновлении хеш атомарно заменяется (ротация).
 */
@Entity("sessions")
@Index("IDX_SESSIONS_USER", ["userId"])
@Index("IDX_SESSIONS_REFRESH_TOKEN_HASH", ["refreshTokenHash"], {
  unique: true,
})
@Index("IDX_SESSIONS_EXPIRES_AT", ["expiresAt"])
export class Session {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({
    name: "refresh_token_hash",
    type: "varchar",
    length: TOKEN_HASH_LENGTH,
  })
  refreshTokenHash!: string;

  /** Срок действующего refresh-токена (его `exp`) — после него сессия мертва. */
  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @Column({ name: "device_name", type: "varchar", length: 200, nullable: true })
  deviceName!: string | null;

  @Column({ name: "device_type", type: "varchar", length: 50, nullable: true })
  deviceType!: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 500, nullable: true })
  userAgent!: string | null;

  @Column({
    name: "last_active_at",
    type: "timestamptz",
    default: () => "CURRENT_TIMESTAMP",
  })
  lastActiveAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
