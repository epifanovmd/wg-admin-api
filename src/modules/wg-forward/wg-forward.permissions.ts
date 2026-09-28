import { definePermissions } from "../permission";

/** Права пробросов портов; по умолчанию — только у admin (через `*`). */
export const WgForwardPermissions = definePermissions(
  "wg",
  { key: "wg:forward", label: "Пробросы портов" },
  {
    FORWARD_VIEW: { name: "wg:forward:view", label: "Просмотр" },
    FORWARD_CREATE: { name: "wg:forward:create", label: "Создание" },
    FORWARD_UPDATE: {
      name: "wg:forward:update",
      label: "Изменение, включение и маршрут",
    },
    FORWARD_DELETE: { name: "wg:forward:delete", label: "Удаление" },
  },
);
