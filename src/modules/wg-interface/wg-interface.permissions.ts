import { definePermissions } from "../permission";

/** Права WG-интерфейсов; по умолчанию — только у admin (через `*`). */
export const WgInterfacePermissions = definePermissions("wg", {
  /** Просмотр интерфейсов и их статусов. */
  INTERFACE_VIEW: "wg:interface:view",
  /** Создание, изменение, включение/выключение и перезапуск интерфейсов. */
  INTERFACE_MANAGE: "wg:interface:manage",
});
