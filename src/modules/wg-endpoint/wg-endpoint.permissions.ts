import { definePermissions } from "../permission";

/** Права точек подключения; по умолчанию — только у admin (через `*`). */
export const WgEndpointPermissions = definePermissions("wg", {
  /** Просмотр точек подключения. */
  ENDPOINT_VIEW: "wg:endpoint:view",
  /** Создание и изменение точек подключения и релеев. */
  ENDPOINT_MANAGE: "wg:endpoint:manage",
});
