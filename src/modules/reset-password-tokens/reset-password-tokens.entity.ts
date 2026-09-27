import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { TOKEN_HASH_LENGTH } from "../../core/auth/token-hash";
import { User } from "../user/user.entity";

/**
 * Токен сброса пароля. По одному на пользователя (PK = userId).
 * Сам токен — случайная строка, в БД только её sha256.
 */
@Entity("reset_password_tokens")
@Index("IDX_RESET_TOKENS_TOKEN_HASH", ["tokenHash"], { unique: true })
export class ResetPasswordTokens {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ name: "token_hash", type: "varchar", length: TOKEN_HASH_LENGTH })
  tokenHash!: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  /** Когда выпущен текущий токен — для cooldown повторной отправки. */
  @Column({ name: "issued_at", type: "timestamptz" })
  issuedAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
