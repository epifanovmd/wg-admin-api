import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { Permission } from "../permission/permission.entity";
import { TRole } from "./role.types";

/** Сущность роли пользователя. Содержит набор разрешений, выданных всем пользователям этой роли. */
@Entity("roles")
export class Role {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 100, unique: true })
  name!: TRole;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // Связи
  @ManyToMany(() => Permission, permission => permission.roles)
  @JoinTable({
    name: "role_permissions",
    joinColumn: { name: "role_id" },
    inverseJoinColumn: { name: "permission_id" },
  })
  permissions!: Permission[];

  /** Преобразовать сущность роли в DTO для передачи клиенту. */
  toDTO() {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      permissions: (this.permissions ?? []).map(permission =>
        permission.toDTO(),
      ),
    };
  }
}
