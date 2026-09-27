/** Чистая математика статистики: монотонные счётчики и скорости. */

/** Скорость по разнице накопленных значений; отрицательное время — 0. */
export const speedBps = (
  prevTotal: number,
  total: number,
  deltaMs: number,
): number => {
  if (deltaMs <= 0) return 0;

  return Math.max(0, Math.round(((total - prevTotal) * 1000) / deltaMs));
};
