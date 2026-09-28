import { existsSync } from "fs";
import type { SignOptions } from "jsonwebtoken";
import path from "path";
import { z } from "zod";

import { PROJECT_ROOT } from "./core/paths";

/**
 * Окружение задаётся явно: `yarn dev` — development, `yarn test` — test.
 * Скомпилированный запуск без NODE_ENV — production: безопасные умолчания
 * (без отладочных логов, сидов и открытой документации).
 */
const nodeEnvSchema = z
  .enum(["development", "production", "test"])
  .default("production");

export const nodeEnv = nodeEnvSchema.parse(process.env.NODE_ENV);
export const isProduction = nodeEnv === "production";
export const isDevelopment = nodeEnv === "development";
export const isTest = nodeEnv === "test";

/**
 * `.env.<NODE_ENV>`, затем `.env` из корня проекта: переменные окружения
 * процесса не перезаписываются, из файлов побеждает первый.
 */
[`.env.${nodeEnv}`, ".env"]
  .map(file => path.join(PROJECT_ROOT, file))
  .filter(file => existsSync(file))
  .forEach(file => process.loadEnvFile(file));

/** Срок токена в формате jsonwebtoken (`ms`): число секунд или 15m, 1h, 7d. */
type JwtExpiresIn = Exclude<SignOptions["expiresIn"], number | undefined>;
const TTL_RE = /^\d+(ms|s|m|h|d|w|y)?$/;

export const positiveInt = z.coerce.number().int().positive();
export const nonNegativeInt = z.coerce.number().int().nonnegative();
export const port = positiveInt.max(65535);
const minutes = positiveInt;
const zeroableInt = z.coerce
  .number()
  .int()
  .transform(v => v || undefined);

export const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform(v => (v === undefined || v === "" ? fallback : v === "true"));
export const optionalString = z
  .string()
  .optional()
  .transform(v => v || undefined);
export const csv = z
  .string()
  .transform(str =>
    str
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()));

/** Секреты, которых нет в тестах: тестам нужен только валидный конфиг. */
const testOnly = <T>(value: T) => (isTest ? value : undefined);

const configSchema = z.object({
  app: z.object({
    /** Имя сервиса: application_name в Postgres, логи, метрики. */
    name: z.string().min(1).default("wg-admin"),
    /**
     * Роль процесса: `api` — HTTP и сокеты, задачи только ставит в очередь;
     * `worker` — выполняет задачи и cron, HTTP только для проб; `all` — оба.
     */
    role: z.enum(["api", "worker", "all"]).default("all"),
    /** Публичный URL API (для ссылок в письмах, подписанных URL файлов). */
    publicUrl: z.string().default("http://localhost:8181"),
    /** Версия сборки: git describe (тег или SHA), в dev — версия package.json. */
    version: z.string().min(1).default("dev"),
    /** Короткий SHA коммита сборки; null — вне сборки образа. */
    commit: z
      .string()
      .optional()
      .transform(value => value || null),
    /** Время сборки (ISO 8601); null — вне сборки образа. */
    builtAt: z
      .string()
      .optional()
      .transform(value => value || null),
  }),

  jobs: z.object({
    /** Параллельно выполняемых задач одной очереди на процесс-воркер. */
    concurrency: positiveInt.default(4),
    /** Сколько ждать завершения активных задач при остановке. */
    shutdownTimeoutMs: positiveInt.default(20_000),
    /** Соединений пула pg-boss на процесс. */
    poolMax: positiveInt.default(4),
    /** Сколько дней хранить завершённые записи задач (`job_runs`). */
    retentionDays: positiveInt.default(30),
  }),

  observability: z.object({
    /** Prometheus-метрики на `/metrics`. */
    metricsEnabled: bool(true),
    /** Bearer-токен для `/metrics`; пусто — без защиты (закрывать сетью). */
    metricsToken: z.string().default(""),
    /** DSN Sentry; пусто — отправка ошибок выключена. */
    sentryDsn: optionalString,
  }),

  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: port.default(8181),
    /**
     * Сервер стоит за доверенным reverse proxy: IP и протокол клиента
     * берутся из `X-Forwarded-*`. Без прокси заголовки подделываемы.
     */
    trustProxy: bool(false),
    /** Swagger UI и спецификация по `/api-docs`; в production — по флагу. */
    docsEnabled: bool(!isProduction),
    /** Дополнительные адреса в `servers` Swagger (удалённые стенды). */
    docsServers: csv.default([]),
    shutdown: z.object({
      /** Пауза после `/ready` → 503, чтобы балансировщик снял реплику. */
      drainMs: nonNegativeInt.default(isProduction ? 5_000 : 0),
      /** Сколько ждать in-flight запросы, прежде чем рвать соединения. */
      inflightTimeoutMs: positiveInt.default(10_000),
      /** Общий предел остановки; дальше процесс завершается принудительно. */
      timeoutMs: positiveInt.default(45_000),
    }),
  }),

  logging: z.object({
    level: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default(isDevelopment ? "debug" : "info"),
    /** Человекочитаемый вывод (pino-pretty) — только для разработки. */
    pretty: bool(isDevelopment),
  }),

  redis: z.object({
    /**
     * Общий Redis для нескольких реплик: лимиты запросов, отзыв токенов и
     * адаптер Socket.IO. Без него всё это живёт в памяти одной реплики.
     */
    url: optionalString,
  }),

  rateLimit: z.object({
    limit: zeroableInt.default(1000),
    intervalMs: zeroableInt.default(15 * 60 * 1000),
  }),

  cors: z.object({
    /** Разрешённые origin фронтендов; `*` допустим только вне production. */
    allowedOrigins: csv.default(["http://localhost:3000"]),
  }),

  auth: z.object({
    jwt: z.object({
      /** HS256: ключ не короче 32 байт. */
      secretKey: z.string().min(32),
      /** Срок access-токена в формате jsonwebtoken: 15m, 1h, 1d */
      accessTtl: z
        .string()
        .regex(TTL_RE, "Формат jsonwebtoken: 900, 15m, 1h, 1d")
        .default(isDevelopment ? "1d" : "15m")
        .transform(v => v as JwtExpiresIn),
      /** Срок refresh-токена и сессии, дней */
      refreshTtlDays: positiveInt.default(7),
      /**
       * Refresh-токен ещё и в httpOnly-cookie (веб-клиенты): JS его не видит,
       * `/auth/refresh` берёт его из cookie, если в теле нет.
       */
      refreshCookie: bool(false),
    }),
    admin: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
    otp: z.object({
      expireMinutes: minutes.default(10),
    }),
    resetPassword: z.object({
      expireMinutes: minutes.default(60),
      webUrl: z
        .string()
        .default("http://localhost:3000/reset-password?token={{token}}"),
    }),
    webAuthn: z.object({
      rpName: z.string().default("Test"),
      rpHost: z.string().default("localhost"),
      rpSchema: z.string().default("http"),
      rpPort: z.string().default("3000"),
    }),
  }),

  database: z.object({
    postgres: z.object({
      host: z.string().default("localhost"),
      port: port.default(5432),
      database: z.string().min(1).default("postgres"),
      username: z.string().min(1).default("postgres"),
      password: z.string().default(""),
      ssl: bool(false),
      /** PEM-сертификат CA сервера; с ним проверяется подлинность сервера. */
      sslCa: z.string().default(""),
      /** Проверять сертификат сервера (отключать только для dev). */
      sslRejectUnauthorized: bool(true),
      /** Размер пула на реплику; суммарно по репликам — меньше max_connections. */
      poolMax: positiveInt.default(10),
      connectionTimeoutMs: positiveInt.default(5_000),
      statementTimeoutMs: positiveInt.default(30_000),
      /** Запросы дольше этого логируются TypeORM как медленные. */
      slowQueryMs: positiveInt.default(1_000),
      /** Применять ожидающие миграции при старте (под advisory-lock). */
      migrationsRun: bool(true),
    }),
  }),

  email: z.object({
    smtp: z.object({
      /** SMTP-сервер; пусто — почта выключена (вне production письма в лог). */
      host: z.string().default(""),
      port: port.default(465),
      /** TLS с начала соединения (465); для 587/25 — STARTTLS, `false`. */
      secure: optionalString.transform(v =>
        v === undefined ? undefined : v === "true",
      ),
      /** Логин и пароль; пусто — без авторизации (локальный relay, Mailpit). */
      user: z.string().default(""),
      pass: z.string().default(""),
      /** Адрес отправителя; по умолчанию — `user`. */
      from: z.string().default(""),
    }),
  }),
});

/**
 * В production небезопасные умолчания — ошибка запуска, а не предупреждение
 * в логе, который никто не прочитает.
 */
const productionSchema = configSchema.superRefine((cfg, ctx) => {
  if (!isProduction) return;

  const issue = (path: string[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  if (!cfg.database.postgres.password) {
    issue(["database", "postgres", "password"], "POSTGRES_PASSWORD обязателен");
  }
  if (cfg.cors.allowedOrigins.includes("*")) {
    issue(["cors", "allowedOrigins"], "CORS_ALLOWED_ORIGINS: '*' недопустим");
  }
  if (!cfg.redis.url) {
    issue(
      ["redis", "url"],
      "REDIS_URL обязателен: лимиты, отзыв токенов и Socket.IO между репликами",
    );
  }
});

export type Config = z.infer<typeof configSchema>;

const { env } = process;

export const config: Config = productionSchema.parse({
  app: {
    name: env.APP_NAME,
    role: env.APP_ROLE,
    publicUrl: env.APP_PUBLIC_URL,
    version: env.APP_VERSION || env.npm_package_version || undefined,
    commit: env.APP_COMMIT,
    builtAt: env.APP_BUILT_AT,
  },
  jobs: {
    concurrency: env.JOBS_CONCURRENCY,
    shutdownTimeoutMs: env.JOBS_SHUTDOWN_TIMEOUT_MS,
    poolMax: env.JOBS_POOL_MAX,
    retentionDays: env.JOBS_RETENTION_DAYS,
  },
  observability: {
    metricsEnabled: env.METRICS_ENABLED,
    metricsToken: env.METRICS_TOKEN,
    sentryDsn: env.SENTRY_DSN,
  },
  server: {
    host: env.SERVER_HOST,
    port: env.SERVER_PORT,
    trustProxy: env.TRUST_PROXY,
    docsEnabled: env.API_DOCS_ENABLED,
    docsServers: env.API_DOCS_SERVERS,
    shutdown: {
      drainMs: env.SHUTDOWN_DRAIN_MS,
      inflightTimeoutMs: env.SHUTDOWN_INFLIGHT_TIMEOUT_MS,
      timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
  },
  logging: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
  redis: { url: env.REDIS_URL },
  rateLimit: {
    limit: env.RATE_LIMIT,
    intervalMs: env.RATE_LIMIT_INTERVAL,
  },
  cors: {
    allowedOrigins: env.CORS_ALLOWED_ORIGINS,
  },
  auth: {
    jwt: {
      secretKey:
        env.JWT_SECRET_KEY ?? testOnly("test-secret-key-0123456789abcdef"),
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
      refreshCookie: env.AUTH_REFRESH_COOKIE,
    },
    admin: {
      email: env.ADMIN_EMAIL ?? testOnly("admin@test.local"),
      password: env.ADMIN_PASSWORD ?? testOnly("test-admin-password"),
    },
    otp: { expireMinutes: env.OTP_EXPIRE_MINUTES },
    resetPassword: {
      expireMinutes: env.RESET_PASS_TOKEN_EXPIRE_MINUTES,
      webUrl: env.WEB_URL_RESET_PASSWORD,
    },
    webAuthn: {
      rpName: env.WEB_AUTHN_RP_NAME,
      rpHost: env.WEB_AUTHN_RP_HOST,
      rpSchema: env.WEB_AUTHN_RP_SCHEMA,
      rpPort: env.WEB_AUTHN_RP_PORT,
    },
  },
  database: {
    postgres: {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      username: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: env.POSTGRES_SSL,
      sslCa: env.POSTGRES_SSL_CA,
      sslRejectUnauthorized: env.POSTGRES_SSL_REJECT_UNAUTHORIZED,
      poolMax: env.POSTGRES_POOL_MAX,
      connectionTimeoutMs: env.POSTGRES_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: env.POSTGRES_STATEMENT_TIMEOUT_MS,
      slowQueryMs: env.POSTGRES_SLOW_QUERY_MS,
      migrationsRun: env.DB_MIGRATIONS_RUN,
    },
  },
  email: {
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
  },
});

/**
 * Настройки модуля — схема рядом с его кодом, а не в общем конфиге: модуль
 * подключается и удаляется целиком. Переменные окружения к этому моменту
 * уже загружены (импорт этого файла).
 */
export const defineModuleConfig = <S extends z.ZodType>(
  section: string,
  schema: S,
  values: z.input<S>,
): z.output<S> => {
  const result = schema.safeParse(values);

  if (!result.success) {
    throw new Error(
      `Конфигурация модуля «${section}»: ${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
};
