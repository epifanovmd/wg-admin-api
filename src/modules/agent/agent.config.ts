import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

import { defineModuleConfig, optionalString, positiveInt } from "../../config";
import { resolveFromRoot } from "../../core";

/**
 * Архивы папки агента, если `AGENT_BUNDLE_DIR` не задан: их собирает
 * `yarn agent:pack`, в образе они лежат там же.
 */
export const AGENT_BUNDLE_DIR_DEFAULT = "agent/bundle";

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
     * Архивы папки агента для нод (`yarn agent:pack` = `agent pack --env prod`):
     * `agent-prod-<версия>-linux-<arch>.tar.gz` — их ставит `agent install`, и
     * `release/` — сборки воркеров wg и socks для их обновления (`worker.update`).
     * Относительный путь — от корня проекта; архивов нет — ноды с API не ставятся.
     */
    bundleDir: optionalString.transform(dir =>
      dir ? resolveFromRoot(dir) : undefined,
    ),
    /**
     * Ключ шифрования значений настроек воркеров в БД (AES-256-GCM, 32 байта
     * hex или base64): в настройках бывают ключи и пароли. Без него значения
     * хранятся как есть.
     */
    configsKey: optionalString,
    /** Адрес сервера для агентов (скрипт и команда установки); без него — из запроса. */
    publicUrl: optionalString,
    /**
     * Проверка `data` событий воркеров по `events[].schema` манифеста
     * (`schemaProblems` SDK в `onEvent`): `off` — нет; `log` — не подошло:
     * журнал и пометка в истории, событие обрабатывается как обычно;
     * `reject` — то же, но обработчикам модулей оно не передаётся (в истории —
     * с пометкой).
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
    bundleDir: process.env.AGENT_BUNDLE_DIR ?? AGENT_BUNDLE_DIR_DEFAULT,
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
