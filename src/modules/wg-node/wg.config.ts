import { createHash } from "crypto";
import { z } from "zod";

import { defineModuleConfig, isProduction, positiveInt } from "../../config";

/**
 * В dev/test секреты шифруются производным ключом — чтобы модуль работал
 * без настройки; в production `WG_SECRETS_KEY` обязателен.
 */
const devFallbackKey = createHash("sha256")
  .update("wg-dev-secrets-key")
  .digest("hex");

/** Ключ секретов из env: пустое значение равносильно отсутствию. */
export const resolveSecretsKey = (
  raw: string | undefined,
  production: boolean,
): string => raw || (production ? "" : devFallbackKey);

/** Настройки WG-домена (env `WG_*`). */
export const wgConfig = defineModuleConfig(
  "wg",
  z.object({
    /** Ключ AES-256-GCM для приватных ключей и PSK в БД: 32 байта hex/base64. */
    secretsKey: z.string().min(1, "WG_SECRETS_KEY обязателен в production"),
    /** Предел ожидания long-poll агента за desired-state (агент просит `waitMs`). */
    agentPollWaitMs: positiveInt.default(25_000),
    /** Агент молчит дольше — нода считается offline. */
    agentOfflineAfterSec: positiveInt.default(90),
    /** Срок команды агенту (перезапуск интерфейса, журнал): `timeoutSec`. */
    commandTimeoutSec: positiveInt.default(60),
    /** Предел накопленного вывода команды. */
    commandOutputMaxBytes: positiveInt.default(256 * 1024),
    /** Сколько хранить завершённые команды. */
    commandRetentionDays: positiveInt.default(7),
    /** Хранение статистики: минутные сэмплы и часовые агрегаты. */
    statsSampleRetentionDays: positiveInt.default(31),
    statsHourRetentionDays: positiveInt.default(366),
    /** Хранение системных метрик нод. */
    nodeMetricRetentionDays: positiveInt.default(14),
    /** Подсеть /30-блоков IPIP-туннелей релеев. */
    relayTunnelCidr: z.string().default("10.99.0.0/16"),
  }),
  {
    secretsKey: resolveSecretsKey(process.env.WG_SECRETS_KEY, isProduction),
    agentPollWaitMs: process.env.WG_AGENT_POLL_WAIT_MS,
    agentOfflineAfterSec: process.env.WG_AGENT_OFFLINE_AFTER_SEC,
    commandTimeoutSec: process.env.WG_COMMAND_TIMEOUT_SEC,
    commandOutputMaxBytes: process.env.WG_COMMAND_OUTPUT_MAX_BYTES,
    commandRetentionDays: process.env.WG_COMMAND_RETENTION_DAYS,
    statsSampleRetentionDays: process.env.WG_STATS_SAMPLE_RETENTION_DAYS,
    statsHourRetentionDays: process.env.WG_STATS_HOUR_RETENTION_DAYS,
    nodeMetricRetentionDays: process.env.WG_NODE_METRIC_RETENTION_DAYS,
    relayTunnelCidr: process.env.WG_RELAY_TUNNEL_CIDR,
  },
);
