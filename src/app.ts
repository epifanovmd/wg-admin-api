import KoaRouter from "@koa/router";
import { createServer } from "http";
import { decorate, injectable } from "inversify";
import Koa from "koa";
import { setTimeout as sleep } from "timers/promises";
import { Controller } from "tsoa";
import { DataSource } from "typeorm";

import { iocContainer } from "./app.container";
import { config, nodeEnv } from "./config";
import {
  BOOTSTRAP,
  buildDocsServers,
  DbHealthMonitor,
  EventBus,
  hasPendingMigrations,
  HttpServer,
  IBootstrap,
  IRouteProvider,
  logger,
  metricsMiddleware,
  ModuleLoader,
  ROUTE_PROVIDER,
  runMigrations,
} from "./core";
import {
  notFoundMiddleware,
  RegisterAppMiddlewares,
  RegisterBaseMiddlewares,
} from "./middleware";
import {
  RegisterRoutes,
  RegisterSwagger,
  RegisterSystemRoutes,
} from "./routing";

type Constructor = new (...args: any[]) => any;

export interface AppOptions {
  rootModule: Constructor;
  dataSource: DataSource;
}

/** Базовая задержка между попытками подключения к БД (ms). */
const DB_BASE_DELAY_MS = 1_000;
/** Максимальная задержка между попытками (ms). */
const DB_MAX_DELAY_MS = 30_000;
/** Интервал логирования при долгом ожидании БД (каждые N попыток). */
const DB_LOG_EVERY_N_ATTEMPTS = 10;

/**
 * Жизненный цикл приложения.
 *
 * Запуск:
 * 1. HTTP-сервер и служебные маршруты — liveness работает сразу.
 * 2. БД — бесконечный retry с backoff; `/ready` отвечает 503, пока ждём.
 * 3. Миграции под advisory-lock (реплики стартуют одновременно безопасно).
 * 4. Модули и DI, маршруты API.
 * 5. Бутстраперы; затем `isReady = true`.
 *
 * Остановка (SIGTERM): `/ready` → 503, пауза, чтобы балансировщик перестал
 * слать трафик, сервер перестаёт принимать соединения, in-flight запросы
 * дорабатывают до `shutdown.inflightTimeoutMs`, затем сокеты и фоновые
 * задачи закрываются, последней — БД.
 */
export class App {
  private readonly koa = new Koa();
  private readonly httpServer: HttpServer;
  private readonly dbHealth: DbHealthMonitor;
  private readonly dataSource: DataSource;
  private readonly rootModule: Constructor;
  private _isReady = false;
  private _stopping: Promise<void> | null = null;

  constructor({ rootModule, dataSource }: AppOptions) {
    this.rootModule = rootModule;
    this.dataSource = dataSource;
    this.dbHealth = new DbHealthMonitor(dataSource);
    // За балансировщиком клиентский IP и протокол берутся из X-Forwarded-*
    // только когда прокси доверенный — иначе заголовки подделываемы.
    this.koa.proxy = config.server.trustProxy;
    this.httpServer = createServer(this.koa.callback());
  }

  /** Готовность к трафику: бутстраперы завершены и БД доступна. */
  get isReady(): boolean {
    return this._isReady && this.dbHealth.isHealthy;
  }

  async start(): Promise<void> {
    this.registerCoreBindings();
    this.koa.use(metricsMiddleware);
    RegisterBaseMiddlewares(this.koa);
    this.configureSystemRoutes();
    RegisterAppMiddlewares(this.koa);
    await this.listen();

    await this.connectDatabase();
    await this.applyMigrations();
    await this.dbHealth.start();

    new ModuleLoader(iocContainer).load(this.rootModule);

    // Процесс-воркер отвечает только на пробы: API-маршруты не нужны.
    if (config.app.role !== "worker") this.configureAppRoutes();

    await this.runBootstrappers();

    this._isReady = true;
    logger.info("Application is ready to accept traffic");
  }

  stop(): Promise<void> {
    this._stopping ??= this.shutdown();

    return this._stopping;
  }

  // ─── Запуск ────────────────────────────────────────────────────────

  private registerCoreBindings(): void {
    decorate(injectable(), Controller);

    iocContainer.bind(DataSource).toConstantValue(this.dataSource);
    iocContainer.bind<Koa>(Koa).toConstantValue(this.koa);
    iocContainer.bind(HttpServer).toConstantValue(this.httpServer);
  }

  private configureSystemRoutes(): void {
    const router = new KoaRouter();

    RegisterSystemRoutes(router, {
      isReady: () => this.isReady,
      dbHealth: this.dbHealth,
    });
    this.koa.use(router.routes());
    this.koa.use(router.allowedMethods());
  }

  private configureAppRoutes(): void {
    const router = new KoaRouter();

    if (config.server.docsEnabled) {
      RegisterSwagger(router, "/api-docs", origin =>
        buildDocsServers({
          origin,
          port: config.server.port,
          publicUrl: config.app.publicUrl,
          extra: config.server.docsServers,
        }),
      );
    }
    RegisterRoutes(router);

    // Маршруты модулей вне tsoa (потоковая раздача файлов и т. п.)
    if (iocContainer.isBound(ROUTE_PROVIDER)) {
      for (const provider of iocContainer.getAll<IRouteProvider>(
        ROUTE_PROVIDER,
      )) {
        provider.register(router);
      }
    }

    this.koa.use(router.routes());
    this.koa.use(router.allowedMethods());
    this.koa.use(notFoundMiddleware);
  }

  private async runBootstrappers(): Promise<void> {
    for (const bootstrapper of iocContainer.getAll<IBootstrap>(BOOTSTRAP)) {
      const name = bootstrapper.constructor.name;

      try {
        await bootstrapper.initialize();
      } catch (err) {
        if (bootstrapper.critical === false) {
          logger.warn(
            { err, bootstrapper: name },
            "Non-critical bootstrapper failed (skipping)",
          );
        } else {
          logger.error(
            { err, bootstrapper: name },
            "Critical bootstrapper failed (aborting startup)",
          );
          throw err;
        }
      }
    }
  }

  /** Порт занят или адрес недоступен — запуск падает через bootstrap, а не крэшем. */
  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { port, host } = config.server;
      const server = this.httpServer;

      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        this.logStartup(host, port);
        resolve();
      });
    });
  }

  // ─── БД ────────────────────────────────────────────────────────────

  /**
   * Бесконечный retry подключения с exponential backoff (1s → 30s).
   * Сервер живёт и отвечает на `/ping` и `/ready` (503), пока БД недоступна.
   */
  private async connectDatabase(): Promise<void> {
    const { host, port, database } = config.database.postgres;
    const db = `${host}:${port}/${database}`;
    let attempt = 0;

    while (true) {
      attempt += 1;

      try {
        if (attempt === 1 || attempt % DB_LOG_EVERY_N_ATTEMPTS === 0) {
          logger.info({ attempt, db }, "Connecting to database...");
        }

        await this.dataSource.initialize();
        logger.info({ attempt, db }, "Database connection established");

        return;
      } catch (error) {
        if (attempt <= 3 || attempt % DB_LOG_EVERY_N_ATTEMPTS === 0) {
          logger.error(
            { err: error, attempt },
            "Database connection failed, retrying...",
          );
        }

        const delay = Math.min(
          DB_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 15),
          DB_MAX_DELAY_MS,
        );

        await sleep(delay);
      }
    }
  }

  /**
   * Схема — только из миграций. С `DB_MIGRATIONS_RUN=false` ожидающие
   * миграции — ошибка запуска: реплика с отставшей схемой не должна
   * принимать трафик.
   */
  private async applyMigrations(): Promise<void> {
    if (config.database.postgres.migrationsRun) {
      const applied = await runMigrations(this.dataSource);

      if (applied.length > 0) {
        logger.info({ migrations: applied }, "Migrations applied");
      }

      return;
    }

    if (await hasPendingMigrations(this.dataSource)) {
      throw new Error(
        "Database schema is behind: run migrations before starting the server",
      );
    }
  }

  // ─── Остановка ─────────────────────────────────────────────────────

  private async shutdown(): Promise<void> {
    const { drainMs, inflightTimeoutMs } = config.server.shutdown;

    this._isReady = false;

    // Балансировщику нужно время увидеть 503 на /ready и убрать реплику.
    if (drainMs > 0) await sleep(drainMs);

    // Новые соединения не принимаются, простаивающие keep-alive закрываются,
    // in-flight запросы дорабатывают; по таймауту рвём оставшиеся.
    const closed = this.closeHttpServer();

    this.httpServer.closeIdleConnections();

    const inflightDone = await Promise.race([
      closed.then(() => true),
      sleep(inflightTimeoutMs, false),
    ]);

    if (!inflightDone) {
      logger.warn("In-flight requests did not finish in time, closing");
      this.httpServer.closeAllConnections();
      await closed;
    }

    // Бутстраперы — в обратном порядке: сокеты, фоновые задачи.
    await this.destroyBootstrappers();

    if (iocContainer.isBound(EventBus)) iocContainer.get(EventBus).clear();

    this.dbHealth.stop();

    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy().catch(err => {
        logger.error({ err }, "Database destroy error");
      });
      logger.info("Database connection closed");
    }
  }

  private closeHttpServer(): Promise<void> {
    return new Promise(resolve => {
      if (!this.httpServer.listening) return resolve();

      this.httpServer.close(() => resolve());
    });
  }

  private async destroyBootstrappers(): Promise<void> {
    if (!iocContainer.isBound(BOOTSTRAP)) return;

    const bootstrappers = iocContainer.getAll<IBootstrap>(BOOTSTRAP).reverse();

    for (const bootstrapper of bootstrappers) {
      try {
        await bootstrapper.destroy?.();
      } catch (err) {
        logger.error(
          { err, bootstrapper: bootstrapper.constructor.name },
          "Bootstrapper destroy failed (continuing shutdown)",
        );
      }
    }
  }

  private logStartup(host: string, port: number): void {
    // 0.0.0.0/:: — «все интерфейсы», в браузере такой адрес даёт чужой origin
    const hostname = ["0.0.0.0", "::"].includes(host) ? "localhost" : host;
    const { host: dbHost, port: dbPort, database } = config.database.postgres;

    logger.info(
      {
        env: nodeEnv,
        role: config.app.role,
        url: `http://${hostname}:${port}`,
        ...(config.server.docsEnabled && {
          swagger: `http://${hostname}:${port}/api-docs`,
        }),
        db: `${dbHost}:${dbPort}/${database}`,
      },
      "Server launched successfully",
    );
  }
}
