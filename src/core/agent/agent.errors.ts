import { defineErrors } from "../http";

/** Ошибки агентов. */
export const AgentError = defineErrors("AGENT", {
  NOT_FOUND: { status: 404, message: "Агент не найден" },
  REVOKED: { status: 409, message: "Агент отозван" },
  OFFLINE: { status: 503, message: "Агент не на связи" },
  WORKER_NOT_FOUND: { status: 404, message: "Воркера нет на агенте" },
  WORKER_NOT_RELEASED: {
    status: 409,
    message: "У воркера нет сборки с сервера",
  },
  COMMAND_UNDECLARED: {
    status: 422,
    message: "Воркер не объявил такую команду",
  },
  CONFIG_UNDECLARED: {
    status: 422,
    message: "Воркер не объявил такой ключ настроек",
  },
  CONFIG_INVALID: {
    status: 400,
    message: "Значение настройки не подходит под схему воркера",
  },
  COMMAND_INVALID: {
    status: 400,
    message: "Аргументы команды не подходят под схему воркера",
  },
  COMMAND_NOT_FOUND: { status: 404, message: "Команда не найдена" },
  TIMEOUT: { status: 504, message: "Агент не прислал итог в срок" },
  UPDATE_NOT_AVAILABLE: { status: 409, message: "Новой версии нет" },
  RELEASE_NOT_FOUND: { status: 404, message: "Сборки нет в каталоге" },
  ENROLLMENT_TOKEN_NOT_FOUND: {
    status: 404,
    message: "Токен регистрации не найден",
  },
});
