import { definePermissions } from "../permission";

/** Права модуля API-ключей; по умолчанию — только у admin (через `*`). */
export const ApiKeyPermissions = definePermissions("apikey", {
  /** Создание, просмотр и отзыв API-ключей. */
  MANAGE: "apikey:manage",
});
