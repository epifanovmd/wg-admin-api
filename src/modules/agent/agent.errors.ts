import { defineErrors } from "../../core";

/** Ошибки доступа к агентам (сверх ошибок ядра `AgentError`). */
export const AgentAccessError = defineErrors("AGENT", {
  FORBIDDEN: { status: 403, message: "Нет доступа к агенту" },
  AGENT_REQUIRED: {
    status: 403,
    message: "Нужен id агента: доступ есть не ко всем агентам",
  },
  NOT_WATCHED: { status: 409, message: "Сокет не в комнате агента" },
});
