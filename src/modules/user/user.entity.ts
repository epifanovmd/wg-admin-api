import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { Permission } from "../permission/permission.entity";
import { Profile } from "../profile/profile.entity";
import { Role } from "../role/role.entity";

/** Сущность пользователя системы. */
@Entity("users")
@Index("IDX_USERS_EMAIL", ["email"], {
  unique: true,
  where: "email IS NOT NULL",
})
@Index("IDX_USERS_PHONE", ["phone"], {
  unique: true,
  where: "phone IS NOT NULL",
})
@Index("IDX_USERS_USERNAME", ["username"], {
  unique: true,
  where: "username IS NOT NULL",
})
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  email!: string | null;

  // Флаг подтверждения email через OTP
  @Column({ name: "email_verified", type: "boolean", default: false })
  emailVerified!: boolean;

  @Column({ type: "varchar", length: 14, nullable: true })
  phone!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true, unique: true })
  username!: string | null;

  /** Хеш пароля (`core/auth/password`); `text` — длина хеша не ограничивает схему. */
  @Column({ name: "password_hash", type: "text" })
  passwordHash!: string;

  @Column({ name: "two_factor_hash", type: "text", nullable: true })
  twoFactorHash!: string | null;

  @Column({
    name: "two_factor_hint",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  twoFactorHint!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // ── Связи ──────────────────────────────────────────────────────────────────

  /**
   * Роли, назначенные этому пользователю.
   * Эффективные разрешения = объединение всех разрешений ролей + directPermissions.
   */
  @ManyToMany(() => Role)
  @JoinTable({
    name: "user_roles",
    joinColumn: { name: "user_id" },
    inverseJoinColumn: { name: "role_id" },
  })
  roles!: Role[];

  /**
   * Разрешения, выданные напрямую этому пользователю (дополнительно к разрешениям ролей).
   * Полезно для точечного переопределения без создания новой роли.
   */
  @ManyToMany(() => Permission)
  @JoinTable({
    name: "user_permissions",
    joinColumn: { name: "user_id" },
    inverseJoinColumn: { name: "permission_id" },
  })
  directPermissions!: Permission[];

  @OneToOne(() => Profile, profile => profile.user, {
    cascade: true,
  })
  profile!: Profile;
}
