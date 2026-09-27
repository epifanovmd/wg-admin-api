import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { User } from "./user.entity";

/**
 * Запрос на смену email: адрес меняется только после ввода кода,
 * отправленного на новый адрес. Один активный запрос на пользователя.
 */
@Entity("email_change_requests")
@Index("IDX_EMAIL_CHANGE_REQUESTS_USER", ["userId"], { unique: true })
export class EmailChangeRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ name: "new_email", type: "varchar", length: 50 })
  newEmail!: string;

  /** SHA-256 кода с солью из id пользователя; сам код не хранится. */
  @Column({ name: "code_hash", type: "varchar", length: 64 })
  codeHash!: string;

  /** Неверных вводов кода. */
  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
