// Первым: Sentry подключается до загрузки остальных модулей.
import "./core/observability/instrument";
import "reflect-metadata";

import { App } from "./app";
import { AppModule } from "./app.module";
import { config } from "./config";
import { flushErrors, logger, reportProcessError } from "./core";
import AppDataSource from "./data-source";

/** Отправить накопленные ошибки перед выходом процесса. */
const exit = async (code: number) => {
  await flushErrors();
  process.exit(code);
};

const bootstrap = async () => {
  const app = new App({ rootModule: AppModule, dataSource: AppDataSource });

  await app.start();

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress, ignoring");

      return;
    }
    shuttingDown = true;

    logger.info({ signal }, "Shutting down gracefully...");

    // Если остановка не уложилась в таймаут — процесс завершается сам,
    // оркестратор всё равно пришлёт SIGKILL.
    setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, config.server.shutdown.timeoutMs).unref();

    app
      .stop()
      .then(() => {
        logger.info("Server closed.");

        return exit(0);
      })
      .catch(error => {
        logger.error({ err: error }, "Error during shutdown");

        return exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Необработанный reject — ошибка кода, но не повод ронять трафик: логируем.
  process.on("unhandledRejection", (reason, promise) => {
    logger.error(
      { err: reason, promise: String(promise) },
      "Unhandled promise rejection",
    );
    reportProcessError(reason, "unhandledRejection");
  });

  // Состояние процесса может быть повреждено: корректно завершаемся,
  // оркестратор перезапустит.
  process.on("uncaughtException", error => {
    logger.fatal({ err: error }, "Uncaught exception — shutting down");
    reportProcessError(error, "uncaughtException");
    shutdown("uncaughtException");
  });
};

bootstrap().catch(error => {
  logger.error({ err: error }, "Failed to start application");
  reportProcessError(error, "uncaughtException");
  void exit(1);
});
