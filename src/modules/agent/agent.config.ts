import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

import {
  bool,
  defineModuleConfig,
  optionalString,
  port,
  positiveInt,
} from "../../config";
import { resolveFromRoot } from "../../core";

/**
 * Архивы папки агента, если `AGENT_BUNDLE_DIR` не задан: их собирает
 * `yarn agent:pack`, в образе они лежат там же.
 */
export const AGENT_BUNDLE_DIR_DEFAULT = "agent/bundle";

/** Репозиторий релизов агента, если `AGENT_RELEASES_GITHUB` не задан. */
export const AGENT_RELEASES_GITHUB_DEFAULT = "epifanovmd/agent";

/** Диапазон версий агента, если `AGENT_RELEASES_RANGE` не задан. */
export const AGENT_RELEASES_RANGE_DEFAULT = "^1";

/**
 * Открытый ключ автора агента: им подписаны агент и netprobe в релизах
 * GitHub; `install.sh` передаёт его узлу вместе с ключом проекта.
 */
export const AGENT_RELEASES_PUBLIC_KEY_DEFAULT =
  "9yYblu2wKJnjKccihbJv2lKtbxvqecCnX67u9LmgSuo=";

/** Настройки агентов (env `AGENT_*`). */
export const agentConfig = defineModuleConfig(
  "agent",
  z.object({
    /**
     * Общий токен регистрации из окружения (многоразовый, без записи в БД):
     * агенты в compose и dev регистрируются без создания токена. Не короче 32
     * символов; без него — только токены из БД.
     */
    bootstrapToken: z
      .string()
      .min(32, "AGENT_BOOTSTRAP_TOKEN — не короче 32 символов")
      .optional(),
    /** Как часто агент присылает статус, мс. */
    statusIntervalMs: positiveInt.default(15_000),
    /** Как часто агент присылает метрики, мс. */
    metricsIntervalMs: positiveInt.default(15_000),
    /** Сколько дней хранить события воркеров. */
    eventsRetentionDays: positiveInt.default(14),
    /**
     * Сколько агент считается на связи после обрыва, мс (как в SDK: убитый
     * агент — offline через 3 с).
     */
    offlineGraceMs: positiveInt.default(3_000),
    /**
     * Общий секрет копий API для пересылки вызовов агентов (relay): вызов
     * в копии без соединения агента уходит в копию с соединением на её
     * внутренний сервер пересылки (`relayHost:relayPort`, маршрут
     * `/internal/agent-relay`). Без секрета пересылки и сервера нет (одна
     * копия или липкая маршрутизация по агенту).
     */
    relaySecret: z
      .string()
      .min(32, "AGENT_RELAY_SECRET — не короче 32 символов")
      .optional(),
    /**
     * Порт внутреннего сервера пересылки (отдельно от публичного порта API):
     * у каждой копии на одной машине — свой.
     */
    relayPort: port.default(8182),
    /**
     * Адрес, на котором слушает сервер пересылки: в контейнере — `0.0.0.0`
     * (копии ходят друг к другу по сети compose), иначе — только локально.
     */
    relayHost: z.string().min(1).default("127.0.0.1"),
    /**
     * Внутренний адрес сервера пересылки этой копии (`http://host:port`):
     * по нему другие копии находят её. Без него — `AGENT_RELAY_HOST` (для
     * `0.0.0.0` — IPv4 машины или контейнера) и `AGENT_RELAY_PORT`.
     */
    instanceUrl: optionalString,
    /**
     * Архивы папки агента для нод (`yarn agent:pack` = `agent pack --env prod`):
     * `agent-prod-<версия>-linux-<arch>.tar.gz` — их ставит `agent install`, и
     * `release/` — сборки воркеров wg и socks для их обновления (`worker.update`).
     * Относительный путь — от корня проекта; архивов нет — ноды с API не ставятся.
     */
    bundleDir: optionalString.transform(dir =>
      dir ? resolveFromRoot(dir) : undefined,
    ),
    /**
     * Откуда брать агента и netprobe: репозиторий GitHub `owner/repo` (его
     * релизы) или адрес сборок `releasesUrl` (он важнее). Пусто и без
     * `releasesUrl` — агент только с узлов, где он уже стоит.
     */
    releasesGithub: optionalString,
    /** Диапазон версий агента из релизов GitHub (semver). */
    releasesRange: z.string().min(1).default(AGENT_RELEASES_RANGE_DEFAULT),
    /** Токен GitHub для запросов к API релизов (лимиты запросов). */
    releasesToken: optionalString,
    /**
     * Адрес сборок одной версии агента (`<url>/manifest.json`, `<url>/<файл>`,
     * `<url>/install.sh`): своё зеркало или закреплённая версия.
     */
    releasesUrl: optionalString,
    /**
     * Сборки агента узлам — через бэкенд потоком (узлы без доступа к
     * GitHub); иначе узел получает перенаправление на GitHub.
     */
    releasesProxy: bool(false),
    /** Как часто проверять новую версию агента, мс (первая проверка — при старте). */
    releasesCheckIntervalMs: positiveInt.default(3_600_000),
    /** Открытый ключ автора агента (base64): им подписаны агент и netprobe. */
    releasesPublicKey: optionalString,
    /**
     * Ключ шифрования значений настроек воркеров в БД (AES-256-GCM, 32 байта
     * hex или base64): в настройках бывают ключи и пароли. Без него значения
     * хранятся как есть.
     */
    configsKey: optionalString,
    /** Адрес сервера для агентов (скрипт и команда установки); без него — из запроса. */
    publicUrl: optionalString,
    /**
     * Проверка `data` событий воркеров по `events[].schema` манифеста:
     * `off` — нет; `log` — не подошло: журнал и пометка в истории, событие
     * обрабатывается как обычно; `reject` — то же, но обработчикам модулей
     * оно не передаётся (в истории — с пометкой).
     */
    validateEvents: z
      .string()
      .default("log")
      .pipe(z.enum(["off", "log", "reject"])),
  }),
  {
    bootstrapToken: process.env.AGENT_BOOTSTRAP_TOKEN || undefined,
    statusIntervalMs: process.env.AGENT_STATUS_INTERVAL_MS,
    metricsIntervalMs: process.env.AGENT_METRICS_INTERVAL_MS,
    eventsRetentionDays: process.env.AGENT_EVENTS_RETENTION_DAYS,
    offlineGraceMs: process.env.AGENT_OFFLINE_GRACE_MS,
    relaySecret: process.env.AGENT_RELAY_SECRET || undefined,
    relayPort: process.env.AGENT_RELAY_PORT || undefined,
    relayHost: process.env.AGENT_RELAY_HOST || undefined,
    instanceUrl: process.env.INSTANCE_URL,
    bundleDir: process.env.AGENT_BUNDLE_DIR ?? AGENT_BUNDLE_DIR_DEFAULT,
    releasesGithub:
      process.env.AGENT_RELEASES_GITHUB ?? AGENT_RELEASES_GITHUB_DEFAULT,
    releasesRange: process.env.AGENT_RELEASES_RANGE || undefined,
    releasesToken: process.env.AGENT_RELEASES_TOKEN,
    releasesUrl: process.env.AGENT_RELEASES_URL,
    releasesProxy: process.env.AGENT_RELEASES_PROXY,
    releasesCheckIntervalMs:
      process.env.AGENT_RELEASES_CHECK_INTERVAL_MS || undefined,
    releasesPublicKey:
      process.env.AGENT_RELEASES_PUBLIC_KEY ??
      AGENT_RELEASES_PUBLIC_KEY_DEFAULT,
    configsKey: process.env.AGENT_CONFIGS_KEY,
    publicUrl: process.env.AGENT_PUBLIC_URL,
    validateEvents: process.env.AGENT_VALIDATE_EVENTS || undefined,
  },
);

/**
 * Сборки воркеров wg и socks для `worker.update` — `release/` каталога архивов
 * (`agent pack --release-out`); нет — воркеры с API не обновляются.
 */
export const bundleReleasesDir = (): string | undefined => {
  const dir = agentConfig.bundleDir && join(agentConfig.bundleDir, "release");

  return dir && existsSync(join(dir, "manifest.json")) ? dir : undefined;
};
