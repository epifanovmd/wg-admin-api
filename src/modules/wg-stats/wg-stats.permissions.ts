import { definePermissions } from "../permission";

/**
 * Права статистики. `wg:stats:own` — статистика собственных пиров; выдаётся
 * роли `user` при засеве (`WgSeedBootstrap`).
 */
export const WgStatsPermissions = definePermissions("wg", {
  /** Глобальная статистика: overview, серии, live любой ноды/пира. */
  STATS_VIEW: "wg:stats:view",
  /** Статистика только своих пиров. */
  STATS_OWN: "wg:stats:own",
});
