import { inject } from "inversify";

import type { IGrantResolver, IUserGrant } from "../../core";
import { Injectable } from "../../core";
import type { User } from "./user.entity";
import { UserRepository } from "./user.repository";

/** Роли и эффективные права пользователя: права ролей ∪ прямые права. */
export const grantOfUser = (user: User): IUserGrant => {
  const rolePermissions =
    user.roles?.flatMap(r => r.permissions?.map(p => p.name) ?? []) ?? [];
  const directPermissions = user.directPermissions?.map(p => p.name) ?? [];

  return {
    roles: user.roles?.map(r => r.name) ?? [],
    permissions: [...new Set([...rolePermissions, ...directPermissions])],
  };
};

/** Актуальные права пользователя из БД для `AccessService` ядра. */
@Injectable()
export class UserGrantResolver implements IGrantResolver {
  constructor(
    @inject(UserRepository) private readonly _users: UserRepository,
  ) {}

  async grantOf(userId: string): Promise<IUserGrant | null> {
    const user = await this._users.findOne({
      where: { id: userId },
      relations: { roles: { permissions: true }, directPermissions: true },
    });

    return user ? grantOfUser(user) : null;
  }
}
