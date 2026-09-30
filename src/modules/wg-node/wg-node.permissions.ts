import { definePermissions } from "../permission";

/**
 * Права нод. Действия над нодой — с областью: право на все ноды или `…:own` —
 * только на свои (назначенный владелец или создатель). По умолчанию — только
 * у admin (через `*`).
 */
export const WgNodePermissions = definePermissions(
  "wg",
  { key: "wg:node", label: "Ноды" },
  {
    NODE_VIEW: {
      name: "wg:node:view",
      label: "Просмотр и метрики",
      scoped: true,
    },
    NODE_CREATE: { name: "wg:node:create", label: "Создание" },
    NODE_UPDATE: { name: "wg:node:update", label: "Изменение", scoped: true },
    NODE_DELETE: { name: "wg:node:delete", label: "Удаление", scoped: true },
    NODE_AGENT: {
      name: "wg:node:agent",
      label: "Ключ и обновление агента",
      scoped: true,
    },
    NODE_LOGS: { name: "wg:node:logs", label: "Журнал агента", scoped: true },
    NODE_PROVISION: {
      name: "wg:node:provision",
      label: "Установка и удаление агента по SSH",
      scoped: true,
    },
    NODE_ASSIGN: {
      name: "wg:node:assign",
      label: "Назначение и снятие владельца",
      scoped: true,
    },
  },
);
