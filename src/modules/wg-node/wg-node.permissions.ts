import { definePermissions } from "../permission";

/** Права нод; по умолчанию — только у admin (через `*`). */
export const WgNodePermissions = definePermissions(
  "wg",
  { key: "wg:node", label: "Ноды" },
  {
    NODE_VIEW: { name: "wg:node:view", label: "Просмотр и метрики" },
    NODE_CREATE: { name: "wg:node:create", label: "Создание" },
    NODE_UPDATE: { name: "wg:node:update", label: "Изменение" },
    NODE_DELETE: { name: "wg:node:delete", label: "Удаление" },
    NODE_AGENT: {
      name: "wg:node:agent",
      label: "Ключ и обновление агента",
    },
    NODE_LOGS: { name: "wg:node:logs", label: "Журнал агента" },
    NODE_PROVISION: {
      name: "wg:node:provision",
      label: "Установка и удаление агента по SSH",
    },
  },
);
