import { definePermissions } from "../permission";

/**
 * Права статистики. `wg:stats:own` — статистика собственных пиров; выдаётся
 * роли `user` при засеве (`WgSeedBootstrap`).
 */
export const WgStatsPermissions = definePermissions(
  "wg",
  { key: "wg:stats", label: "Статистика" },
  {
    STATS_VIEW: { name: "wg:stats:view", label: "Глобальная статистика" },
    STATS_OWN: { name: "wg:stats:own", label: "Статистика своих пиров" },
  },
);
