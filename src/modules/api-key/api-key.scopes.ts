import { hasPermission } from "../../core";

/**
 * Scopes ключа покрывают требуемый: точное совпадение, wildcard
 * (`worker:*`, `*`) или — для требования без действия (`worker`) — любой
 * scope этого домена (`worker:demo.echo`). Конкретную очередь проверяет
 * сервис по `worker:<queue>`.
 */
export const scopeSatisfied = (granted: string[], required: string): boolean =>
  hasPermission(granted, required) ||
  granted.some(scope => scope.startsWith(`${required}:`));
