import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { TOKEN_HASH_LENGTH } from "../../core";
import { User } from "../user/user.entity";

/**
 * API-ключ сервиса (внешний воркер, интеграция). Ключ `<prefix>.<secret>`
 * показывается один раз; в БД — префикс для поиска и sha256 секрета.
 */
@Entity("api_keys")
@Index("IDX_API_KEYS_PREFIX", ["prefix"], { unique: true })
@Index("IDX_API_KEYS_OWNER", ["ownerId"])
export class ApiKey {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "varchar", length: 8 })
  prefix!: string;

  /** sha256 секрета, hex. */
  @Column({ type: "varchar", length: TOKEN_HASH_LENGTH })
  hash!: string;

  /** Разрешения ключа: `worker:demo.echo`, `worker:*`. */
  @Column({ type: "varchar", length: 100, array: true, default: () => "'{}'" })
  scopes!: string[];

  /** Кто выпустил ключ; от его имени действует сервис. */
  @Column({ name: "owner_id", type: "uuid" })
  ownerId!: string;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_id" })
  owner?: User;
}
