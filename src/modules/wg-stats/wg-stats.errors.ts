import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_STATS_*`. */
export const WgStatsError = defineErrors("WG_STATS", {
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Недостаточно прав для просмотра статистики",
  },
  BAD_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: "Некорректный диапазон времени",
  },
});
