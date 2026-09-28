import { TRole } from "../role.types";

/**
 * Роль удалена. `memberIds` — её бывшие пользователи: их эффективные права
 * изменились, а связь с ролью в БД уже удалена.
 */
export class RoleDeletedEvent {
  constructor(
    public readonly roleId: string,
    public readonly roleName: TRole,
    public readonly memberIds: string[],
  ) {}
}
