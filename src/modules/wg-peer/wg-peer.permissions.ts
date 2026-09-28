import { definePermissions } from "../permission";

/**
 * Права пиров. `wg:peer:own` — базовое право пользователя VPN: видеть свои
 * пиры, скачивать их конфиги/QR и включать-выключать их; выдаётся роли
 * `user` при засеве (`WgSeedBootstrap` в модуле wg-stats).
 */
export const WgPeerPermissions = definePermissions(
  "wg",
  { key: "wg:peer", label: "Пиры" },
  {
    PEER_VIEW: {
      name: "wg:peer:view",
      label: "Просмотр всех пиров и конфигов",
    },
    PEER_OWN: {
      name: "wg:peer:own",
      label: "Свои пиры: конфиг, QR, включение",
    },
    PEER_CREATE: { name: "wg:peer:create", label: "Создание" },
    PEER_UPDATE: { name: "wg:peer:update", label: "Изменение" },
    PEER_DELETE: { name: "wg:peer:delete", label: "Удаление" },
    PEER_TOGGLE: {
      name: "wg:peer:toggle",
      label: "Включение и выключение любых пиров",
    },
    PEER_PSK: { name: "wg:peer:psk", label: "Preshared-ключи" },
    PEER_ASSIGN: {
      name: "wg:peer:assign",
      label: "Назначение и снятие владельца",
    },
  },
);
