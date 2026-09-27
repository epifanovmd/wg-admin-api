import { definePermissions } from "../permission";

/**
 * Права пиров. `wg:peer:own` — базовое право пользователя VPN: видеть свои
 * пиры, скачивать их конфиги/QR и включать-выключать их; выдаётся роли
 * `user` при засеве (`WgSeedBootstrap` в модуле wg-stats).
 */
export const WgPeerPermissions = definePermissions("wg", {
  /** Просмотр всех пиров и их конфигов. */
  PEER_VIEW: "wg:peer:view",
  /** Создание, изменение, удаление, назначение пиров. */
  PEER_MANAGE: "wg:peer:manage",
  /** Доступ к собственным пирам (конфиг, QR, включение/выключение). */
  PEER_OWN: "wg:peer:own",
});
