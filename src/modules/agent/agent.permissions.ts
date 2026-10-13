import { definePermissions } from "../permission";

/** Права модуля агентов; по умолчанию — только у admin (через `*`). */
export const AgentPermissions = definePermissions(
  "agent",
  { key: "agent", label: "Агенты" },
  {
    VIEW: {
      name: "agent:view",
      label: "Просмотр: агенты, воркеры, настройки, команды, события, метрики",
    },
    MANAGE: {
      name: "agent:manage",
      label:
        "Управление: отзыв, удаление, ключ, обновление агента и воркеров, перезапуск воркеров",
    },
    CONFIG: { name: "agent:config", label: "Настройки воркеров (значения)" },
    COMMAND: { name: "agent:command", label: "Команды воркерам" },
    LOGS: { name: "agent:logs", label: "Журнал агента и воркеров" },
    ENROLL: {
      name: "agent:enroll",
      label: "Регистрация агентов: токены, команда установки",
    },
  },
);
