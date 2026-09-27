import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "../user/user.entity";

/** Одноразовый код (OTP) для верификации email. Один на пользователя. */
@Entity("otp")
export class Otp {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId!: string;

  /** Шестизначный код подтверждения. */
  @Column({ type: "varchar", length: 6 })
  code!: string;

  @Column({ name: "expire_at", type: "timestamptz" })
  expireAt!: Date;

  /** Неудачные попытки ввода текущего кода. */
  @Column({ type: "int", default: 0 })
  attempts!: number;

  /** Когда отправлен текущий код — для cooldown повторной отправки. */
  @Column({ name: "sent_at", type: "timestamptz" })
  sentAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
