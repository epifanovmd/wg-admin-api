import { definePermissions } from "../permission";

/**
 * Права статистики: `wg:stats:view` — вся статистика, `wg:stats:view:own` —
 * только по своим пирам; выдаётся роли `user` при засеве (`WgSeedBootstrap`).
 */
export const WgStatsPermissions = definePermissions(
  "wg",
  { key: "wg:stats", label: "Статистика" },
  {
    STATS_VIEW: { name: "wg:stats:view", label: "Просмотр", scoped: true },
  },
);
