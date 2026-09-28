import { definePermissions } from "../permission";

/** Права WG-интерфейсов; по умолчанию — только у admin (через `*`). */
export const WgInterfacePermissions = definePermissions(
  "wg",
  { key: "wg:interface", label: "Интерфейсы" },
  {
    INTERFACE_VIEW: { name: "wg:interface:view", label: "Просмотр" },
    INTERFACE_CREATE: { name: "wg:interface:create", label: "Создание" },
    INTERFACE_UPDATE: { name: "wg:interface:update", label: "Изменение" },
    INTERFACE_DELETE: { name: "wg:interface:delete", label: "Удаление" },
    INTERFACE_CONTROL: {
      name: "wg:interface:control",
      label: "Включение, выключение и перезапуск",
    },
    INTERFACE_MOVE: {
      name: "wg:interface:move",
      label: "Перенос на другую ноду",
    },
    INTERFACE_REPLICAS: { name: "wg:interface:replicas", label: "Реплики" },
    INTERFACE_HOOKS: {
      name: "wg:interface:hooks",
      label: "Свои команды PostUp/PostDown",
    },
  },
);
