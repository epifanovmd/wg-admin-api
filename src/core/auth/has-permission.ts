import { ALL_PERMISSIONS, SUPERUSER_ROLE } from "./superuser";

/** Последний сегмент права «только на свои» сущности: `wg:peer:update:own`. */
export const OWN_SCOPE_SUFFIX = "own";

/** Право «только на свои» для права на действие: `x:update` → `x:update:own`. */
export const ownPermission = (permission: string): string =>
  `${permission}:${OWN_SCOPE_SUFFIX}`;

const isOwnPermission = (permission: string): boolean =>
  permission.endsWith(`:${OWN_SCOPE_SUFFIX}`);

const matches = (userPerms: string[], required: string): boolean => {
  if (userPerms.includes(required)) return true;

  const parts = required.split(":");

  // eslint-disable-next-line no-plusplus
  for (let i = parts.length - 1; i >= 1; i--) {
    const wildcard = `${parts.slice(0, i).join(":")}:*`;

    if (userPerms.includes(wildcard)) return true;
  }

  return false;
};

/**
 * Проверяет, удовлетворяет ли набор разрешений пользователя требуемому разрешению,
 * включая разрешение wildcards. Право на действие над всеми сущностями покрывает
 * то же право «только на свои»: `x:update` ⊃ `x:update:own`.
 */
export const hasPermission = (
  userPerms: string[],
  required: string,
): boolean => {
  if (userPerms.includes(ALL_PERMISSIONS)) return true;
  if (matches(userPerms, required)) return true;

  return (
    isOwnPermission(required) &&
    matches(userPerms, required.slice(0, -OWN_SCOPE_SUFFIX.length - 1))
  );
};

/** Суперпользователь по ролям и правам: роль `admin` или право `*`. */
export const isSuperUserGrant = (roles: string[], permissions: string[]) =>
  roles.includes(SUPERUSER_ROLE) || hasPermission(permissions, ALL_PERMISSIONS);
