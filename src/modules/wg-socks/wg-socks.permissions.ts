import { definePermissions } from "../permission";

/** Права прокси-сервисов; по умолчанию — только у admin (через `*`). */
export const WgSocksPermissions = definePermissions(
  "wg",
  { key: "wg:socks", label: "Прокси" },
  {
    SOCKS_VIEW: { name: "wg:socks:view", label: "Просмотр" },
    SOCKS_CREATE: { name: "wg:socks:create", label: "Создание" },
    SOCKS_UPDATE: { name: "wg:socks:update", label: "Изменение и включение" },
    SOCKS_DELETE: { name: "wg:socks:delete", label: "Удаление" },
    SOCKS_USERS: { name: "wg:socks:users", label: "Пользователи прокси" },
    SOCKS_SECRETS: {
      name: "wg:socks:secrets",
      label: "Просмотр паролей пользователей",
    },
    SOCKS_CLIENTS: {
      name: "wg:socks:clients",
      label: "Сертификаты и клиенты устройств",
    },
  },
);
