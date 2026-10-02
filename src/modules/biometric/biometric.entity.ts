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

import { User } from "../user/user.entity";

@Entity("biometrics")
@Index("IDX_BIOMETRICS_USER_DEVICE", ["userId", "deviceId"], { unique: true })
export class Biometric {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ name: "device_id", type: "varchar", length: 100 })
  deviceId!: string;

  /** Публичный ключ устройства (SPKI DER в base64). */
  @Column({ name: "public_key", type: "text" })
  publicKey!: string;

  @Column({ name: "device_name", type: "varchar", length: 100, nullable: true })
  deviceName!: string | null;

  /** Текущий одноразовый nonce для подписи. */
  @Column({ type: "varchar", length: 64, nullable: true })
  challenge!: string | null;

  @Column({ name: "challenge_expires_at", type: "timestamptz", nullable: true })
  challengeExpiresAt!: Date | null;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
