import { ALL_PERMISSIONS, SUPERUSER_ROLE } from "./superuser";

/**
 * Проверяет, удовлетворяет ли набор разрешений пользователя требуемому разрешению,
 * включая разрешение wildcards.
 */
export const hasPermission = (
  userPerms: string[],
  required: string,
): boolean => {
  if (userPerms.includes(ALL_PERMISSIONS)) return true;
  if (userPerms.includes(required)) return true;

  const parts = required.split(":");

  // eslint-disable-next-line no-plusplus
  for (let i = parts.length - 1; i >= 1; i--) {
    const wildcard = `${parts.slice(0, i).join(":")}:*`;

    if (userPerms.includes(wildcard)) return true;
  }

  return false;
};

/** Суперпользователь по ролям и правам: роль `admin` или право `*`. */
export const isSuperUserGrant = (roles: string[], permissions: string[]) =>
  roles.includes(SUPERUSER_ROLE) || hasPermission(permissions, ALL_PERMISSIONS);
