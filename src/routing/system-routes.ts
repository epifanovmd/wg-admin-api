import KoaRouter from "@koa/router";
import { timingSafeEqual } from "crypto";
import type { Context } from "koa";

import { iocContainer } from "../app.container";
import { config, isProduction } from "../config";
import type { DbHealthMonitor, IHealthIndicator, PingableRedis } from "../core";
import {
  getRedis,
  HEALTH_INDICATOR,
  HealthStatus,
  metricsRegistry,
  probeRedis,
  runHealthIndicators,
} from "../core";
import { UnauthorizedException } from "../core/http";

export interface SystemRoutesDeps {
  /** Готовность приложения к трафику (бутстраперы завершены, БД доступна). */
  isReady: () => boolean;
  dbHealth: Pick<DbHealthMonitor, "probe">;
  /** Клиент Redis для `/health`; по умолчанию — общий (`undefined` без `REDIS_URL`). */
  redis?: () => PingableRedis | undefined;
  /** Проверки модулей (`asHealthIndicator`); по умолчанию — из DI-контейнера. */
  healthIndicators?: () => IHealthIndicator[];
  /** SMTP настроен — только факт конфигурации, без соединения. */
  smtpConfigured?: () => boolean;
  metrics?: { enabled: boolean; token: string };
}

/** Проверки модулей появляются после загрузки модулей — берутся на запросе. */
const indicatorsFromContainer = (): IHealthIndicator[] =>
  iocContainer.isBound(HEALTH_INDICATOR)
    ? iocContainer.getAll<IHealthIndicator>(HEALTH_INDICATOR)
    : [];

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

const isMetricsAuthorized = (ctx: Context, token: string): boolean =>
  !token || safeEqual(ctx.get("authorization"), `Bearer ${token}`);

/**
 * Служебные маршруты. Регистрируются до бизнес-middleware: без rate limit,
 * CORS и авторизации, но с request id и единым форматом ошибок.
 */
export const RegisterSystemRoutes = (
  router: KoaRouter,
  {
    isReady,
    dbHealth,
    redis = getRedis,
    healthIndicators = indicatorsFromContainer,
    smtpConfigured = () => !!config.email.smtp.host,
    metrics = {
      enabled: config.observability.metricsEnabled,
      token: config.observability.metricsToken,
    },
  }: SystemRoutesDeps,
) => {
  /** Liveness: процесс жив и принимает соединения. */
  router.get("/ping", ctx => {
    ctx.status = 200;
    ctx.body = { serverTime: new Date().toISOString() };
  });

  /**
   * Readiness: 200 только когда все бутстраперы завершились и БД доступна
   * (по кэшированной фоновой проверке). 503 — на старте, при потере БД и
   * во время остановки: балансировщик снимает реплику с трафика. Для
   * воркера смысл тот же: обработчики задач запущены и БД жива.
   */
  router.get("/ready", ctx => {
    const ready = isReady();

    ctx.status = ready ? 200 : 503;
    ctx.body = { status: ready ? "ready" : "not_ready", role: config.app.role };
  });

  /**
   * Диагностика зависимостей: живые проверки Postgres, Redis (PING) и
   * проверок модулей с таймаутом; SMTP — только факт настройки. 503, если
   * упала критичная зависимость. Подробности процесса — не в production.
   */
  router.get("/health", async ctx => {
    const [database, redisStatus, indicators] = await Promise.all([
      dbHealth.probe(),
      probeRedis(redis()),
      runHealthIndicators(healthIndicators()),
    ]);
    const services: Record<string, HealthStatus> = {
      database: database ? "ok" : "error",
      redis: redisStatus,
      smtp: smtpConfigured() ? "ok" : "not_configured",
      ...Object.fromEntries(indicators.map(i => [i.name, i.status])),
    };
    const healthy =
      database &&
      redisStatus !== "error" &&
      indicators.every(i => !i.critical || i.status === "ok");
    const memory = process.memoryUsage();

    ctx.status = healthy ? 200 : 503;
    ctx.body = {
      status: healthy ? "ok" : "degraded",
      ready: isReady(),
      role: config.app.role,
      services,
      ...(isProduction
        ? {}
        : {
            uptime: Math.floor(process.uptime()),
            version: config.app.version,
            memory: {
              heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
              heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
              rssMb: Math.round(memory.rss / 1024 / 1024),
            },
          }),
    };
  });

  if (metrics.enabled) {
    /** Prometheus; с `METRICS_TOKEN` — только с `Authorization: Bearer <token>`. */
    router.get("/metrics", async ctx => {
      if (!isMetricsAuthorized(ctx, metrics.token)) {
        ctx.set("WWW-Authenticate", "Bearer");
        throw new UnauthorizedException("Нужен токен метрик");
      }

      ctx.set("Content-Type", metricsRegistry.contentType);
      ctx.body = await metricsRegistry.metrics();
    });
  }
};
