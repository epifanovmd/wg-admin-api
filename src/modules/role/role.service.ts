import { inject } from "inversify";

import {
  EventBus,
  Injectable,
  isSuperUser,
  isUniqueViolation,
} from "../../core";
import { AuthContext } from "../../types/koa";
import {
  getRegisteredPermissions,
  PermissionRepository,
  Permissions,
  TPermission,
} from "../permission";
import { RolePermissionsChangedEvent } from "./events";
import { Role } from "./role.entity";
import { RoleError } from "./role.errors";
import { RoleRepository } from "./role.repository";
import { KnownRole, Roles, TRole } from "./role.types";

/**
 * Права ролей по умолчанию. Обычным ролям просмотр и управление
 * пользователями не выдаются — это делается точечно.
 */
const ROLE_DEFAULT_PERMISSIONS: Record<KnownRole, TPermission[]> = {
  [Roles.ADMIN]: [Permissions.ALL],
  [Roles.USER]: [],
  [Roles.GUEST]: [],
};

/** Сервис для управления ролями и их разрешениями. */
@Injectable()
export class RoleService {
  constructor(
    @inject(RoleRepository) private _roleRepository: RoleRepository,
    @inject(PermissionRepository)
    private _permissionRepository: PermissionRepository,
    @inject(EventBus) private _eventBus: EventBus,
  ) {}

  /** Получить все роли с их разрешениями. */
  async getRoles(): Promise<Role[]> {
    return this._roleRepository.findAll();
  }

  /** Создать новую роль. */
  async createRole(name: TRole): Promise<Role> {
    if (await this._roleRepository.findByName(name)) {
      throw RoleError.ALREADY_EXISTS({ name });
    }

    try {
      return await this._roleRepository.createAndSave({ name });
    } catch (err) {
      // Параллельное создание той же роли.
      if (isUniqueViolation(err)) {
        throw RoleError.ALREADY_EXISTS({ name });
      }
      throw err;
    }
  }

  /** Удалить роль по ID. */
  async deleteRole(roleId: string): Promise<void> {
    const role = await this._roleRepository.findById(roleId);

    if (!role) {
      throw RoleError.NOT_FOUND();
    }

    await this._roleRepository.delete({ id: roleId });
  }

  /**
   * Заменить набор разрешений роли (отсутствующие разрешения создаются).
   * Роль `admin`, право `*` и собственную роль инициатора меняет только
   * суперпользователь. Эмитит `RolePermissionsChangedEvent`.
   */
  async setRolePermissions(
    actor: AuthContext,
    roleId: string,
    permissions: TPermission[],
  ): Promise<Role> {
    const role = await this._roleRepository.findById(roleId);

    if (!role) {
      throw RoleError.NOT_FOUND();
    }

    if (!isSuperUser(actor)) {
      if (role.name === Roles.ADMIN || permissions.includes(Permissions.ALL)) {
        throw RoleError.SUPERUSER_ONLY();
      }

      if (actor.roles.includes(role.name)) {
        throw RoleError.OWN_ROLE();
      }
    }

    const names = [...new Set(permissions)];

    role.permissions = await Promise.all(
      names.map(name => this._permissionRepository.ensureByName(name)),
    );

    await this._roleRepository.save(role);

    this._eventBus.emit(
      new RolePermissionsChangedEvent(role.id, role.name, names),
    );

    const updated = await this._roleRepository.findById(roleId);

    if (!updated) {
      throw RoleError.NOT_FOUND();
    }

    return updated;
  }

  /**
   * Засеивает справочник прав (все права, объявленные модулями через
   * `definePermissions`, и совместимый `Permissions`) и права ролей по
   * умолчанию. Идемпотентно: роли и права создаются через
   * `ON CONFLICT DO NOTHING`, у роли с уже назначенными правами набор не
   * трогается (ручные изменения сохраняются).
   */
  async seedDefaultPermissions(): Promise<void> {
    for (const name of getRegisteredPermissions()) {
      await this._permissionRepository.ensureByName(name);
    }

    for (const [roleName, permissions] of Object.entries(
      ROLE_DEFAULT_PERMISSIONS,
    )) {
      const role = await this._roleRepository.ensureByName(roleName);

      if (role.permissions?.length || permissions.length === 0) continue;

      const granted = await Promise.all(
        permissions.map(name => this._permissionRepository.ensureByName(name)),
      );

      await this._roleRepository.grantPermissionsIfMissing(
        role.id,
        granted.map(permission => permission.id),
      );
    }
  }
}
