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

/** Команда установки агента: срок токена. */
export interface ICreateWgNodeInstallCommandBody {
  /** Срок одноразового токена регистрации, минут (по умолчанию сутки). */
  expiresInMinutes?: number;
}

/** Привязать к ноде уже зарегистрированного агента. */
export interface IBindWgNodeAgentBody {
  agentId: string;
}

/** Обновить воркер агента ноды из выпуска. */
export interface IUpdateWgNodeWorkerBody {
  /** Заменить сразу, не дожидаясь окончания работы воркера. */
  force?: boolean;
}
