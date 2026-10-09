import { z } from "zod";

import {
  bool,
  csv,
  defineModuleConfig,
  optionalString,
  port,
  positiveInt,
} from "../../config";
import { resolveFromRoot } from "../../core";

/** Экземпляр агента проекта на узле, если `AGENT_INSTANCE` не задан. */
export const AGENT_INSTANCE_DEFAULT = "wg";

/**
 * Каталог сборок, если `AGENT_RELEASES_DIR` не задан: его собирает
 * `agent/release.sh`, в образе он лежит там же.
 */
export const AGENT_RELEASES_DIR_DEFAULT = "agent/release";

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
     * Каталог воркеров проекта (wg и socks): `manifest.json` от
     * `agent-release` и их сборки — его собирает `agent/release.sh`.
     * Относительный путь — от корня проекта; каталога нет — воркеров
     * проекта на сервере нет.
     */
    releasesDir: optionalString.transform(dir =>
      dir ? resolveFromRoot(dir) : undefined,
    ),
    /**
     * Откуда брать агента и netprobe: репозиторий GitHub `owner/repo` (его
     * релизы) или адрес сборок `releasesUrl` (он важнее). Пусто и без
     * `releasesUrl` — агент только из `releasesDir`.
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
    /** Открытый ключ автора агента (base64) для `install.sh`. */
    releasesPublicKey: optionalString,
    /**
     * Открытые ключи проекта (base64, через запятую) — пара к
     * `AGENT_SIGNING_KEY`, которым `agent/release.sh` подписывает воркеры
     * wg и socks; `install.sh` передаёт их узлу (`--update-key`).
     */
    updatePublicKeys: csv,
    /**
     * Ключ шифрования значений настроек воркеров в БД (AES-256-GCM, 32 байта
     * hex или base64): в настройках бывают ключи и пароли. Без него значения
     * хранятся как есть.
     */
    configsKey: optionalString,
    /**
     * Экземпляр агента проекта на узле (`agent install --instance`): свои
     * служба `agent-<имя>`, настройки `/etc/agent-<имя>` и данные
     * `/var/lib/agent-<имя>` — агенты других бэкендов на том же узле не
     * мешают. Пустое значение — экземпляр по умолчанию (`agent`).
     */
    instance: z
      .string()
      .regex(
        /^([a-z][a-z0-9-]{0,31})?$/,
        "AGENT_INSTANCE — строчная латиница, цифры и «-», первая — буква, до 32 символов",
      )
      .transform(name => name || undefined),
    /** Адрес сервера для агентов (`install.sh`, ссылки); без него — из запроса. */
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
    releasesDir: process.env.AGENT_RELEASES_DIR ?? AGENT_RELEASES_DIR_DEFAULT,
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
    updatePublicKeys: process.env.AGENT_UPDATE_PUBLIC_KEY ?? "",
    configsKey: process.env.AGENT_CONFIGS_KEY,
    instance: process.env.AGENT_INSTANCE ?? AGENT_INSTANCE_DEFAULT,
    publicUrl: process.env.AGENT_PUBLIC_URL,
    validateEvents: process.env.AGENT_VALIDATE_EVENTS || undefined,
  },
);
