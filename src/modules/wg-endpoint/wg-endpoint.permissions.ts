import { definePermissions } from "../permission";

/**
 * Права точек подключения. Действия над точкой — с областью: право на все
 * точки или `…:own` — только на свои (назначенный владелец или создатель).
 * По умолчанию — только у admin (через `*`).
 */
export const WgEndpointPermissions = definePermissions(
  "wg",
  { key: "wg:endpoint", label: "Точки подключения" },
  {
    ENDPOINT_VIEW: {
      name: "wg:endpoint:view",
      label: "Просмотр",
      scoped: true,
    },
    ENDPOINT_CREATE: { name: "wg:endpoint:create", label: "Создание" },
    ENDPOINT_UPDATE: {
      name: "wg:endpoint:update",
      label: "Изменение",
      scoped: true,
    },
    ENDPOINT_DELETE: {
      name: "wg:endpoint:delete",
      label: "Удаление",
      scoped: true,
    },
    ENDPOINT_ASSIGN: {
      name: "wg:endpoint:assign",
      label: "Назначение и снятие владельца",
      scoped: true,
    },
  },
);
