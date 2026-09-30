import { definePermissions } from "../permission";

/**
 * Права пробросов портов. Действия над пробросом — с областью: право на все
 * пробросы или `…:own` — только на свои (назначенный владелец или создатель).
 * По умолчанию — только у admin (через `*`).
 */
export const WgForwardPermissions = definePermissions(
  "wg",
  { key: "wg:forward", label: "Пробросы портов" },
  {
    FORWARD_VIEW: { name: "wg:forward:view", label: "Просмотр", scoped: true },
    FORWARD_CREATE: { name: "wg:forward:create", label: "Создание" },
    FORWARD_UPDATE: {
      name: "wg:forward:update",
      label: "Изменение, включение и маршрут",
      scoped: true,
    },
    FORWARD_DELETE: {
      name: "wg:forward:delete",
      label: "Удаление",
      scoped: true,
    },
    FORWARD_ASSIGN: {
      name: "wg:forward:assign",
      label: "Назначение и снятие владельца",
      scoped: true,
    },
  },
);
