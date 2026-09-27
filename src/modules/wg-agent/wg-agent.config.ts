import { z } from "zod";

import { defineModuleConfig, positiveInt } from "../../config";
import { resolveFromRoot } from "../../core";

/** Настройки раздачи агента и канала постоянной связи (env `WG_AGENT_*`). */
export const wgAgentConfig = defineModuleConfig(
  "wgAgent",
  z.object({
    /**
     * Каталог релиза агента: `wg-admin-agent-linux-<arch>` и `VERSION`.
     * Относительный путь — от корня проекта.
     */
    distDir: z.string().min(1).default("agent/dist").transform(resolveFromRoot),
    /** Период статистики агента, пока открыта админка. */
    linkLiveStatsMs: positiveInt.default(1000),
    /** Период статистики агента без зрителей. */
    linkIdleStatsMs: positiveInt.default(10_000),
    /** Период проверки живости соединения (ping); без ответа — разрыв. */
    linkHeartbeatMs: positiveInt.default(15_000),
    /** Через сколько после разрыва без нового соединения нода — offline. */
    linkOfflineGraceSec: positiveInt.default(20),
    /** Как часто перепроверяются ключи открытых соединений (отзыв, ротация). */
    linkKeyCheckMs: positiveInt.default(60_000),
  }),
  {
    distDir: process.env.WG_AGENT_DIST_DIR || undefined,
    linkLiveStatsMs: process.env.WG_AGENT_LINK_LIVE_STATS_MS,
    linkIdleStatsMs: process.env.WG_AGENT_LINK_IDLE_STATS_MS,
    linkHeartbeatMs: process.env.WG_AGENT_LINK_HEARTBEAT_MS,
    linkOfflineGraceSec: process.env.WG_AGENT_LINK_OFFLINE_GRACE_SEC,
    linkKeyCheckMs: process.env.WG_AGENT_LINK_KEY_CHECK_MS,
  },
);
