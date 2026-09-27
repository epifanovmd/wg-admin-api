import { In } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { Permission } from "./permission.entity";
import { TPermission } from "./permission.types";

/** Репозиторий для работы с разрешениями (permissions). */
@InjectableRepository(Permission)
export class PermissionRepository extends BaseRepository<Permission> {
  /** Найти разрешение по его уникальному имени. */
  async findByName(name: TPermission): Promise<Permission | null> {
    return this.findOne({ where: { name } });
  }

  /** Найти разрешения по списку имён (отсутствующие просто не попадут в результат). */
  async findByNames(names: TPermission[]): Promise<Permission[]> {
    if (names.length === 0) return [];

    return this.find({ where: { name: In(names) } });
  }

  /** Получить все разрешения, включая связанные роли. */
  async findAll(): Promise<Permission[]> {
    return this.find({ relations: { roles: true } });
  }

  /**
   * Вернуть разрешение по имени, создав его при отсутствии.
   * `ON CONFLICT DO NOTHING` — безопасно при параллельном вызове из нескольких реплик.
   */
  async ensureByName(name: TPermission): Promise<Permission> {
    await this.createQueryBuilder()
      .insert()
      .into(Permission)
      .values({ name })
      .orIgnore()
      .execute();

    return this.findOneOrFail({ where: { name } });
  }
}
