import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import { TOKEN_HASH_LENGTH } from "../../core";
import { ENROLLMENT_TOKEN_PREFIX_LENGTH } from "./agent.types";

/**
 * Токен регистрации агентов: `<prefix>.<secret>` показывается один раз, в
 * БД — префикс для поиска и sha256 секрета. Многоразовый токен регистрирует
 * парк машин или реплики контейнера.
 */
@Entity("agent_enrollment_tokens")
@Index("IDX_AGENT_ENROLLMENT_TOKENS_PREFIX", ["prefix"], { unique: true })
@Index("IDX_AGENT_ENROLLMENT_TOKENS_CREATED", ["createdAt"])
export class AgentEnrollmentToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "varchar", length: ENROLLMENT_TOKEN_PREFIX_LENGTH })
  prefix!: string;

  /** sha256 секрета, hex. */
  @Column({ type: "varchar", length: TOKEN_HASH_LENGTH })
  hash!: string;

  /** Метки, которые получают зарегистрированные агенты (узел их не перепишет). */
  @Column({ type: "jsonb", default: () => "'{}'" })
  labels!: Record<string, string>;

  /** Сколько раз можно использовать; `NULL` — без ограничения. */
  @Column({ name: "max_uses", type: "int", nullable: true })
  maxUses!: number | null;

  @Column({ type: "int", default: 0 })
  uses!: number;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  /** Кто выпустил (без внешнего ключа: токен переживает удаление пользователя). */
  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
