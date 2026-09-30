import { definePermissions } from "../permission";

/**
 * Права пиров. Действия над пиром — с областью: право на все пиры или
 * `…:own` — только на свои (держатель или создатель). Базовые права
 * пользователя VPN (`wg:peer:view:own`, `wg:peer:toggle:own`) выдаются роли
 * `user` при засеве (`WgSeedBootstrap` в модуле wg-stats).
 */
export const WgPeerPermissions = definePermissions(
  "wg",
  { key: "wg:peer", label: "Пиры" },
  {
    PEER_VIEW: {
      name: "wg:peer:view",
      label: "Просмотр, конфиг и QR",
      scoped: true,
    },
    PEER_CREATE: { name: "wg:peer:create", label: "Создание" },
    PEER_UPDATE: { name: "wg:peer:update", label: "Изменение", scoped: true },
    PEER_DELETE: { name: "wg:peer:delete", label: "Удаление", scoped: true },
    PEER_TOGGLE: {
      name: "wg:peer:toggle",
      label: "Включение и выключение",
      scoped: true,
    },
    PEER_PSK: { name: "wg:peer:psk", label: "Preshared-ключи", scoped: true },
    PEER_ASSIGN: {
      name: "wg:peer:assign",
      label: "Назначение и снятие держателя",
      scoped: true,
    },
  },
);
