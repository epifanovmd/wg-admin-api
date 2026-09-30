import { FindOptionsRelations, FindOptionsWhere, ILike, Not } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { BaseRepository, InjectableRepository } from "../../core";
import { IUserOptionDto } from "./dto";
import { User } from "./user.entity";
import { userDisplayName } from "./user-name";

/** Экранирует `%`, `_` и обратный слэш — пользовательский ввод ищется буквально. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, char => `\\${char}`);

/** Репозиторий для работы с пользователями. */
@InjectableRepository(User)
export class UserRepository extends BaseRepository<User> {
  /** Найти пользователя по ID с опциональными связями. */
  async findById(
    id: string,
    relations?: FindOptionsRelations<User>,
  ): Promise<User | null> {
    return this.findOne({
      where: { id },
      relations,
    });
  }

  /** Найти пользователя по email с опциональными связями. */
  async findByEmail(
    email: string,
    relations?: FindOptionsRelations<User>,
  ): Promise<User | null> {
    return this.findOne({
      where: { email },
      relations,
    });
  }

  /** Найти пользователя по номеру телефона с опциональными связями. */
  async findByPhone(
    phone: string,
    relations?: FindOptionsRelations<User>,
  ): Promise<User | null> {
    return this.findOne({
      where: { phone },
      relations,
    });
  }

  /** Найти пользователя по email или телефону; возвращает null, если ни один параметр не передан. */
  async findByEmailOrPhone(
    email?: string | null,
    phone?: string | null,
    relations?: FindOptionsRelations<User>,
  ) {
    const where: FindOptionsWhere<User>[] = [];

    if (email) {
      where.push({ email });
    }
    if (phone) {
      where.push({ phone });
    }

    if (where.length === 0) {
      return null;
    }

    return this.findOne({
      where,
      relations,
    });
  }

  /** Другой пользователь, уже занявший email или телефон. */
  async findConflicting(
    excludeId: string,
    email?: string | null,
    phone?: string | null,
  ): Promise<User | null> {
    const where: FindOptionsWhere<User>[] = [];

    if (email) where.push({ email, id: Not(excludeId) });
    if (phone) where.push({ phone, id: Not(excludeId) });

    if (where.length === 0) return null;

    return this.findOne({ where });
  }

  /** Пользователи роли вместе с их ролями и прямыми разрешениями. */
  async findByRoleId(roleId: string): Promise<User[]> {
    return this.createQueryBuilder("user")
      .innerJoin("user.roles", "filterRole", "filterRole.id = :roleId", {
        roleId,
      })
      .leftJoinAndSelect("user.roles", "roles")
      .leftJoinAndSelect("user.directPermissions", "directPermissions")
      .getMany();
  }

  /** Обновить данные пользователя и вернуть обновлённую запись. */
  async updateWithResponse(
    id: string,
    updateData: QueryDeepPartialEntity<User>,
    relations?: FindOptionsRelations<User>,
  ): Promise<User | null> {
    await this.update(id, updateData);

    return this.findOne({
      where: { id },
      relations,
    });
  }

  /** Найти пользователя по username. */
  async findByUsername(
    username: string,
    relations?: FindOptionsRelations<User>,
  ): Promise<User | null> {
    return this.findOne({
      where: { username },
      relations,
    });
  }

  /** Получить список пользователей для выпадающего списка с опциональной фильтрацией по строке запроса. */
  async findOptions(query?: string): Promise<IUserOptionDto[]> {
    const pattern = query ? `%${escapeLike(query)}%` : null;
    const where: FindOptionsWhere<User>[] = pattern
      ? [
          { email: ILike(pattern) },
          { profile: { firstName: ILike(pattern) } },
          { profile: { lastName: ILike(pattern) } },
        ]
      : [];

    const users = await this.find({
      where: where.length ? where : undefined,
      select: {
        id: true,
        email: true,
        profile: { firstName: true, lastName: true },
      },
      relations: { profile: true },
      order: { email: "ASC" },
    });

    return users.map(u => ({ id: u.id, name: userDisplayName(u) }));
  }
}
