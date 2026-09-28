import { TRole } from "../role.types";

/** Роль создана (без прав). */
export class RoleCreatedEvent {
  constructor(
    public readonly roleId: string,
    public readonly roleName: TRole,
  ) {}
}
