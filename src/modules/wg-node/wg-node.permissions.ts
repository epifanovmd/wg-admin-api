import { definePermissions } from "../permission";

/** Права нод; по умолчанию — только у admin (через `*`). */
export const WgNodePermissions = definePermissions("wg", {
  /** Просмотр нод, их статусов и метрик. */
  NODE_VIEW: "wg:node:view",
  /** Создание и изменение нод, ключи агентов, журнал. */
  NODE_MANAGE: "wg:node:manage",
  /** Установка агента и WireGuard на новый VPS по SSH. */
  NODE_PROVISION: "wg:node:provision",
});
