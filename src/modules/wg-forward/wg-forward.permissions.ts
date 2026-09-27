import { definePermissions } from "../permission";

/** Права пробросов портов; по умолчанию — только у admin (через `*`). */
export const WgForwardPermissions = definePermissions("wg", {
  /** Просмотр пробросов и их маршрутов. */
  FORWARD_VIEW: "wg:forward:view",
  /** Создание, изменение и переключение маршрута пробросов. */
  FORWARD_MANAGE: "wg:forward:manage",
});
