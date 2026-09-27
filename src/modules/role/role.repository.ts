import { In } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { Role } from "./role.entity";
import { TRole } from "./role.types";

/** Репозиторий для работы с ролями. */
@InjectableRepository(Role)
export class RoleRepository extends BaseRepository<Role> {
  /** Найти роль по ID, включая связанные разрешения. */
  async findById(id: string): Promise<Role | null> {
    return this.findOne({
      where: { id },
      relations: { permissions: true },
    });
  }

  /** Найти роль по имени, включая связанные разрешения. */
  async findByName(name: TRole): Promise<Role | null> {
    return this.findOne({
      where: { name },
      relations: { permissions: true },
    });
  }

  /** Найти роли по списку имён вместе с разрешениями. */
  async findByNames(names: TRole[]): Promise<Role[]> {
    if (names.length === 0) return [];

    return this.find({
      where: { name: In(names) },
      relations: { permissions: true },
    });
  }

  /** Получить все роли со связанными разрешениями. */
  async findAll(): Promise<Role[]> {
    return this.find({
      relations: { permissions: true },
    });
  }

  /**
   * Вернуть роль по имени, создав её при отсутствии.
   * `ON CONFLICT DO NOTHING` — безопасно при параллельном вызове из нескольких реплик.
   */
  async ensureByName(name: TRole): Promise<Role> {
    await this.createQueryBuilder()
      .insert()
      .into(Role)
      .values({ name })
      .orIgnore()
      .execute();

    return this.findOneOrFail({
      where: { name },
      relations: { permissions: true },
    });
  }

  /**
   * Выдать роли права, которых у неё нет. `ON CONFLICT DO NOTHING`: реплики,
   * одновременно засевающие роли при старте, не конфликтуют.
   */
  async grantPermissionsIfMissing(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    if (permissionIds.length === 0) return;

    await this.createQueryBuilder()
      .insert()
      .into("role_permissions", ["role_id", "permission_id"])
      .values(
        permissionIds.map(permissionId => ({
          role_id: roleId,
          permission_id: permissionId,
        })),
      )
      .orIgnore()
      .execute();
  }

  /** Обновить роль и вернуть обновлённую запись с разрешениями. */
  async updateWithResponse(
    id: string,
    updateData: Partial<Role>,
  ): Promise<Role | null> {
    await this.update(id, updateData);

    return this.findById(id);
  }
}
