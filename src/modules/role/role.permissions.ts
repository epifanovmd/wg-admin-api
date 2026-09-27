import { definePermissions } from "../permission";

/** Права модуля ролей. */
export const RolePermissions = definePermissions("role", {
  VIEW: "role:view",
  MANAGE: "role:manage",
});
