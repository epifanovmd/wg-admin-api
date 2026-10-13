import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

import {
  defineModuleConfig,
  nonNegativeInt,
  optionalString,
  positiveInt,
} from "../../config";
import { resolveFromRoot } from "../paths";

/** Настройки агентов (env `AGENT_*`). */
export const agentConfig = defineModuleConfig(
  "agent",
  z.object({
    /**
     * Общий токен регистрации из окружения (многоразовый, без записи в БД): агенты в compose
     * и dev регистрируются без создания токена. Не короче 32 символов.
     */
    bootstrapToken: z
      .string()
      .min(32, "AGENT_BOOTSTRAP_TOKEN — не короче 32 символов")
      .optional(),
    /** Как часто агент присылает состояние, мс (ответ на hello). */
    stateIntervalMs: positiveInt.default(30_000),
    /** Как часто агент присылает метрики, мс (ответ на hello). */
    metricsIntervalMs: positiveInt.default(15_000),
    /** Точку метрик в историю — не чаще, мс (0 — каждую). */
    metricsStoreIntervalMs: nonNegativeInt.default(60_000),
    /** Сколько хранить историю метрик, часов. */
    metricsRetentionHours: positiveInt.default(168),
    /** Сколько дней хранить события воркеров и выполненные команды. */
    eventsRetentionDays: positiveInt.default(14),
    /**
     * Архивы папки агента для узлов (`agent pack --env prod`):
     * `agent-*-<версия>-linux-<arch>.tar.gz` и `install.sh` — их ставит `install.sh --bundle`;
     * `release/` — каталог сборок воркеров проекта (`worker.update`, `agent install --worker`).
     * Относительный путь — от корня проекта.
     */
    bundleDir: optionalString.transform(dir =>
      dir ? resolveFromRoot(dir) : undefined,
    ),
    /** Ключ шифрования значений настроек воркеров в БД (AES-256-GCM, 32 байта hex/base64). */
    configsKey: optionalString,
    /** Адрес сервера для агентов (установка, ссылки); без него — из запроса. */
    publicUrl: optionalString,
  }),
  {
    bootstrapToken: process.env.AGENT_BOOTSTRAP_TOKEN || undefined,
    stateIntervalMs: process.env.AGENT_STATE_INTERVAL_MS,
    metricsIntervalMs: process.env.AGENT_METRICS_INTERVAL_MS,
    metricsStoreIntervalMs: process.env.AGENT_METRICS_STORE_INTERVAL_MS,
    metricsRetentionHours: process.env.AGENT_METRICS_RETENTION_HOURS,
    eventsRetentionDays: process.env.AGENT_EVENTS_RETENTION_DAYS,
    bundleDir: process.env.AGENT_BUNDLE_DIR,
    configsKey: process.env.AGENT_CONFIGS_KEY,
    publicUrl: process.env.AGENT_PUBLIC_URL,
  },
);

/** Каталог сборок воркеров проекта — `release/` каталога архивов; нет — `undefined`. */
export const agentReleasesDir = (): string | undefined => {
  const dir = agentConfig.bundleDir && join(agentConfig.bundleDir, "release");

  return dir && existsSync(join(dir, "manifest.json")) ? dir : undefined;
};
