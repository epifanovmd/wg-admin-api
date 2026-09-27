import { definePermissions } from "../permission";

/** Права модуля профилей. */
export const ProfilePermissions = definePermissions("profile", {
  VIEW: "profile:view",
  MANAGE: "profile:manage",
});
