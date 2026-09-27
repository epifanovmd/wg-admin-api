/** Запрос установки агента на VPS по SSH. Секреты нигде не сохраняются
 * в открытом виде: в данных задачи они зашифрованы. */
export interface IProvisionWgNodeBody {
  /** SSH-хост (обычно совпадает с будущим publicHost ноды). */
  host: string;
  /** SSH-порт (по умолчанию 22). */
  port?: number;
  /** Пользователь SSH (по умолчанию root; иначе нужен sudo без пароля). */
  username?: string;
  /** Приватный SSH-ключ (PEM). */
  privateKey?: string;
  /** Пароль SSH (если нет ключа). */
  password?: string;
  /** Публичный URL бэкенда для агента (по умолчанию APP_PUBLIC_URL). */
  backendUrl?: string;
}

/** Запрос удаления агента с VPS по SSH. */
export interface IUninstallWgNodeBody {
  host: string;
  port?: number;
  username?: string;
  privateKey?: string;
  password?: string;
}

/** Поставленная задача установки. */
export interface IWgProvisionStartedDto {
  /** id задачи: прогресс — комната `job` по сокету и `GET /api/v1/jobs/{id}`. */
  jobId: string;
}
