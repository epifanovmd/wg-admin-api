export interface ICreateWgNodeBody {
  name: string;
  description?: string | null;
  /** Публичный хост (IP/домен) — endpoint клиентов по умолчанию. */
  publicHost?: string | null;
  /** Назначенный владелец; другой пользователь — только с правом назначения. */
  ownerId?: string | null;
}

export interface IUpdateWgNodeBody {
  name?: string;
  description?: string | null;
  publicHost?: string | null;
}

export interface IAssignWgNodeBody {
  userId: string;
}

/**
 * Способ установки агента ноды: `systemd` — служба от root (по умолчанию), `docker` — Docker
 * Compose из архива агента (контейнер в сети узла, команда без sudo).
 */
export type TWgNodeInstallMode = "systemd" | "docker";

/** Команда установки агента: срок токена, способ. */
export interface ICreateWgNodeInstallCommandBody {
  /** Срок одноразового токена регистрации, минут (по умолчанию сутки). */
  expiresInMinutes?: number;
  mode?: TWgNodeInstallMode;
}

/**
 * Выдача агента ноды: `.env` (адрес, токен с меткой ноды, имя агента), архив с ним или
 * одноразовая ссылка на архив.
 */
export interface IIssueWgNodeAgentBody {
  /** Имя агента; нет — имя ноды. */
  name?: string;
  /** Адрес сервера для агента; без него — `AGENT_PUBLIC_URL` / `APP_PUBLIC_URL`. */
  baseUrl?: string;
  /** Срок одноразового токена, минут (по умолчанию сутки). */
  expiresInMinutes?: number;
}

export interface IIssueWgNodeAgentLinkBody extends IIssueWgNodeAgentBody {
  /** Срок ссылки, минут (по умолчанию сутки); токен создаётся при скачивании. */
  linkExpiresInMinutes?: number;
}

/** Привязать к ноде уже зарегистрированного агента. */
export interface IBindWgNodeAgentBody {
  agentId: string;
}
