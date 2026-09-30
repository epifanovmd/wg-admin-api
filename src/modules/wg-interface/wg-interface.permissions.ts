import { definePermissions } from "../permission";

/**
 * Права WG-интерфейсов. Действия над интерфейсом — с областью: право на все
 * интерфейсы или `…:own` — только на свои (назначенный владелец или
 * создатель). По умолчанию — только у admin (через `*`).
 */
export const WgInterfacePermissions = definePermissions(
  "wg",
  { key: "wg:interface", label: "Интерфейсы" },
  {
    INTERFACE_VIEW: {
      name: "wg:interface:view",
      label: "Просмотр",
      scoped: true,
    },
    INTERFACE_CREATE: { name: "wg:interface:create", label: "Создание" },
    INTERFACE_UPDATE: {
      name: "wg:interface:update",
      label: "Изменение",
      scoped: true,
    },
    INTERFACE_DELETE: {
      name: "wg:interface:delete",
      label: "Удаление",
      scoped: true,
    },
    INTERFACE_CONTROL: {
      name: "wg:interface:control",
      label: "Включение, выключение и перезапуск",
      scoped: true,
    },
    INTERFACE_MOVE: {
      name: "wg:interface:move",
      label: "Перенос на другую ноду",
      scoped: true,
    },
    INTERFACE_REPLICAS: {
      name: "wg:interface:replicas",
      label: "Реплики",
      scoped: true,
    },
    INTERFACE_HOOKS: {
      name: "wg:interface:hooks",
      label: "Свои команды PostUp/PostDown",
      scoped: true,
    },
    INTERFACE_ASSIGN: {
      name: "wg:interface:assign",
      label: "Назначение и снятие владельца",
      scoped: true,
    },
  },
);
