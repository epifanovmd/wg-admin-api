import { hasPermission } from "../../core";

/**
 * Scopes ключа покрывают требуемый: точное совпадение, wildcard
 * (`integration:*`, `*`) или — для требования без действия (`integration`) —
 * любой scope этого домена (`integration:sync`). Более точную проверку делает
 * вызывающий модуль.
 */
export const scopeSatisfied = (granted: string[], required: string): boolean =>
  hasPermission(granted, required) ||
  granted.some(scope => scope.startsWith(`${required}:`));
