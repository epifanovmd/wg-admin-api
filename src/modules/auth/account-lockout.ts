import type { IAttemptsStore } from "./auth-attempts.store";

/** Неудачных входов в окне до блокировки аккаунта. */
export const LOGIN_MAX_FAILURES = 5;

/** Окно подсчёта неудачных входов. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

/** Длительность блокировки входа. */
export const LOGIN_LOCK_MS = 15 * 60_000;

export interface ILockoutStatus {
  locked: boolean;
  /** Через сколько секунд можно повторить (для `Retry-After`). */
  retryAfterSec: number;
}

const toSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Блокировка входа по аккаунту: `LOGIN_MAX_FAILURES` неудач за
 * `LOGIN_FAILURE_WINDOW_MS` → вход закрыт на `LOGIN_LOCK_MS` для любого IP.
 * Ключ — id пользователя, для несуществующего логина — сам логин: ответы
 * одинаковы и не раскрывают, есть ли аккаунт.
 */
export class AccountLockout {
  constructor(private readonly _store: IAttemptsStore) {}

  /** Заблокирован ли вход сейчас. */
  async status(key: string): Promise<ILockoutStatus> {
    const ttl = await this._store.ttlMs(`login:lock:${key}`);

    return { locked: ttl > 0, retryAfterSec: ttl > 0 ? toSeconds(ttl) : 0 };
  }

  /** Учесть неудачу; на лимите — поставить блокировку. */
  async registerFailure(key: string): Promise<ILockoutStatus> {
    const failures = await this._store.addFailure(
      `login:fail:${key}`,
      LOGIN_FAILURE_WINDOW_MS,
    );

    if (failures < LOGIN_MAX_FAILURES) {
      return { locked: false, retryAfterSec: 0 };
    }

    await this._store.claimOnce(`login:lock:${key}`, LOGIN_LOCK_MS);
    await this._store.resetFailures(`login:fail:${key}`);

    return { locked: true, retryAfterSec: toSeconds(LOGIN_LOCK_MS) };
  }

  /** Успешный вход сбрасывает счётчик. */
  async reset(key: string): Promise<void> {
    await this._store.resetFailures(`login:fail:${key}`);
  }

  /** Снять блокировку и счётчик (пароль сброшен владельцем). */
  async unlock(key: string): Promise<void> {
    await this._store.resetFailures(`login:fail:${key}`);
    await this._store.resetFailures(`login:lock:${key}`);
  }
}
