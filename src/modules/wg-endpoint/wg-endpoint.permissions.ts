import { definePermissions } from "../permission";

/** Права точек подключения; по умолчанию — только у admin (через `*`). */
export const WgEndpointPermissions = definePermissions(
  "wg",
  { key: "wg:endpoint", label: "Точки подключения" },
  {
    ENDPOINT_VIEW: { name: "wg:endpoint:view", label: "Просмотр" },
    ENDPOINT_CREATE: { name: "wg:endpoint:create", label: "Создание" },
    ENDPOINT_UPDATE: { name: "wg:endpoint:update", label: "Изменение" },
    ENDPOINT_DELETE: { name: "wg:endpoint:delete", label: "Удаление" },
  },
);
