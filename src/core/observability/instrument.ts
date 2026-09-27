/**
 * Инструментирование процесса. Импортируется первой строкой `main.ts`: в
 * CJS-сборке и под tsx импорты выполняются по порядку, поэтому Sentry
 * подключается до загрузки остальных модулей.
 *
 * Здесь нельзя импортировать `core/index` и модули приложения — только
 * конфиг и файлы наблюдаемости напрямую.
 */
import { config, nodeEnv } from "../../config";
import { initSentry } from "./sentry";

const { sentryDsn } = config.observability;
const release = process.env.APP_VERSION ?? process.env.npm_package_version;

if (sentryDsn) {
  initSentry({
    dsn: sentryDsn,
    environment: nodeEnv,
    serverName: `${config.app.name}:${config.app.role}`,
    release,
  });
}
