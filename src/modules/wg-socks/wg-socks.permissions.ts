import { definePermissions } from "../permission";

/** Права прокси-сервисов; по умолчанию — только у admin (через `*`). */
export const WgSocksPermissions = definePermissions("wg", {
  /** Просмотр прокси, пользователей и клиентов. */
  SOCKS_VIEW: "wg:socks:view",
  /** Создание, пользователи, сертификаты и их отзыв, клиент для устройства. */
  SOCKS_MANAGE: "wg:socks:manage",
});
