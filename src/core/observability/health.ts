import type { TokenProvider } from "../decorators";

/**
 * Проверка зависимости для `/health` (очередь задач, внешний сервис).
 * Модули регистрируют её `asHealthIndicator(Cls)` в providers.
 */
export interface IHealthIndicator {
  /** Ключ в `services` ответа `/health`. */
  readonly name: string;
  /** Отказ критичной проверки переводит `/health` в 503; по умолчанию — да. */
  readonly critical?: boolean;
  check(): Promise<boolean>;
}

/** Токен multi-inject проверок здоровья. */
export const HEALTH_INDICATOR = Symbol("HealthIndicator");

export const asHealthIndicator = (
  indicator: new (...args: any[]) => IHealthIndicator,
): TokenProvider<IHealthIndicator> => ({
  provide: HEALTH_INDICATOR,
  useClass: indicator,
});

/** Статус зависимости: `not_configured` — выключена настройкой, не ошибка. */
export type HealthStatus = "ok" | "error" | "not_configured";

export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/** Результат проверки или `false` по таймауту/исключению. */
export const checkWithTimeout = async (
  check: () => Promise<boolean>,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([check().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** Клиент с командой `PING` (ioredis). */
export interface PingableRedis {
  ping(): Promise<string>;
}

/** Redis: `PING` с таймаутом; без клиента — `not_configured`. */
export const probeRedis = async (
  client: PingableRedis | undefined,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<HealthStatus> => {
  if (!client) return "not_configured";

  const ok = await checkWithTimeout(
    async () => (await client.ping()) === "PONG",
    timeoutMs,
  );

  return ok ? "ok" : "error";
};

export interface IndicatorResult {
  name: string;
  critical: boolean;
  status: HealthStatus;
}

/** Все проверки параллельно, каждая со своим таймаутом. */
export const runHealthIndicators = (
  indicators: IHealthIndicator[],
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<IndicatorResult[]> =>
  Promise.all(
    indicators.map(async indicator => ({
      name: indicator.name,
      critical: indicator.critical !== false,
      status: (await checkWithTimeout(() => indicator.check(), timeoutMs))
        ? ("ok" as const)
        : ("error" as const),
    })),
  );
