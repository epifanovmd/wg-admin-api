import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Событие безопасности. Без внешнего ключа на пользователя: журнал
 * переживает удаление аккаунта (срок хранения ограничен очисткой).
 */
@Entity("audit_events")
@Index("IDX_AUDIT_EVENTS_ACTOR_CREATED", ["actorId", "createdAt"])
@Index("IDX_AUDIT_EVENTS_TYPE_CREATED", ["type", "createdAt"])
@Index("IDX_AUDIT_EVENTS_CREATED_AT", ["createdAt"])
export class AuditEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  type!: string;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId!: string | null;

  @Column({ name: "subject_id", type: "varchar", length: 255, nullable: true })
  subjectId!: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 500, nullable: true })
  userAgent!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'" })
  meta!: Record<string, unknown>;

  /** Точность — миллисекунды: курсор ленты сравнивает с JS `Date`. */
  @CreateDateColumn({ name: "created_at", type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
