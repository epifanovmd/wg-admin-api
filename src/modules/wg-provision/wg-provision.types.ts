/** Данные задачи `wg.provision-node` (секреты зашифрованы `WgSecretBox`). */
export interface IWgProvisionJobData {
  nodeId: string;
  host: string;
  port: number;
  username: string;
  /** SSH-ключ (PEM), зашифрован. */
  privateKeyEnc?: string;
  /** Пароль SSH, зашифрован. */
  passwordEnc?: string;
  /**
   * Одноразовый токен регистрации агента с меткой ноды, зашифрован
   * (создаётся при постановке).
   */
  tokenEnc: string;
  /** id токена: провал установки — токен отзывается. */
  tokenId: string;
  /** Публичный URL бэкенда, до которого агент будет достукиваться. */
  backendUrl: string;
}

export const WG_PROVISION_QUEUE = "wg.provision-node";

/**
 * Scope задач ноды: совпадает с типом её сокет-комнаты — обновления задачи
 * приходят подписчикам карточки ноды (`wg-node_<id>`).
 */
export const WG_NODE_JOB_SCOPE = "wg-node";

/** Данные задачи `wg.uninstall-node` (секреты зашифрованы `WgSecretBox`). */
export interface IWgUninstallJobData {
  nodeId: string;
  /** Кто запустил: от его имени отзывается агент. */
  actorId: string;
  host: string;
  port: number;
  username: string;
  privateKeyEnc?: string;
  passwordEnc?: string;
}

export const WG_UNINSTALL_QUEUE = "wg.uninstall-node";
