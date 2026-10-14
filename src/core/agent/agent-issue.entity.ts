import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Параметры выдачи: токен создаётся по ним при скачивании архива. */
export interface IAgentIssueParams {
  /** Имя токена регистрации (в списке токенов). */
  tokenName: string;
  /** Имя агента в `.env` (`AGENT_NAME`). */
  name?: string;
  /** Метки токена: их получит зарегистрированный агент. */
  labels: Record<string, string>;
  /** Сколько раз можно использовать токен. */
  maxUses: number;
  /** Срок токена после скачивания, мин. */
  tokenTtlMinutes: number;
  /** Адрес бэкенда в `.env`. */
  server: string;
}

/**
 * Одноразовая ссылка на архив агента с токеном: архив собирается и токен создаётся при
 * скачивании (`GET /agent/v1/bundle/issued/{id}`), ссылка срабатывает один раз и до срока.
 */
@Entity("agent_issues")
export class AgentIssue {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "jsonb" })
  params!: IAgentIssueParams;

  /** Кто выдал (без внешнего ключа: запись переживает удаление пользователя). */
  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  /** До какого момента ссылка работает. */
  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  /** Скачан (ссылка больше не работает). */
  @Column({ name: "downloaded_at", type: "timestamptz", nullable: true })
  downloadedAt!: Date | null;

  /** Токен регистрации, созданный при скачивании. */
  @Column({ name: "token_id", type: "uuid", nullable: true })
  tokenId!: string | null;
}
