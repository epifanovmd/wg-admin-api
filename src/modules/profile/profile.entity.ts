import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "../user/user.entity";

/** Сущность профиля пользователя: личные данные. */
@Entity("profiles")
@Index("IDX_PROFILES_USER_ID", ["userId"], { unique: true })
export class Profile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ name: "first_name", type: "varchar", length: 40, nullable: true })
  firstName!: string | null;

  @Column({ name: "last_name", type: "varchar", length: 40, nullable: true })
  lastName!: string | null;

  // Дата рождения пользователя
  @Column({ name: "birth_date", type: "date", nullable: true })
  birthDate!: Date | null;

  // Пол пользователя в свободной форме
  @Column({ type: "varchar", length: 20, nullable: true })
  gender!: string | null;

  /** Язык пользователя (`ru`, `en-US`): язык писем и уведомлений. */
  @Column({ type: "varchar", length: 10, nullable: true, default: null })
  locale!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // Связи
  @OneToOne(() => User, user => user.profile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
