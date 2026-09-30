import { definePermissions } from "../permission";

/**
 * Права прокси-сервисов. Действия над прокси — с областью: право на все
 * прокси или `…:own` — только на свои (назначенный владелец или создатель).
 * По умолчанию — только у admin (через `*`).
 */
export const WgSocksPermissions = definePermissions(
  "wg",
  { key: "wg:socks", label: "Прокси" },
  {
    SOCKS_VIEW: { name: "wg:socks:view", label: "Просмотр", scoped: true },
    SOCKS_CREATE: { name: "wg:socks:create", label: "Создание" },
    SOCKS_UPDATE: {
      name: "wg:socks:update",
      label: "Изменение и включение",
      scoped: true,
    },
    SOCKS_DELETE: { name: "wg:socks:delete", label: "Удаление", scoped: true },
    SOCKS_USERS: {
      name: "wg:socks:users",
      label: "Пользователи прокси",
      scoped: true,
    },
    SOCKS_SECRETS: {
      name: "wg:socks:secrets",
      label: "Просмотр паролей пользователей",
      scoped: true,
    },
    SOCKS_CLIENTS: {
      name: "wg:socks:clients",
      label: "Сертификаты и клиенты устройств",
      scoped: true,
    },
    SOCKS_ASSIGN: {
      name: "wg:socks:assign",
      label: "Назначение и снятие владельца",
      scoped: true,
    },
  },
);
