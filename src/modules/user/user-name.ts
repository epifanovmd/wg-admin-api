import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";

/** Поля пользователя, из которых складывается отображаемое имя. */
export interface IUserNameSource {
  email: string | null;
  profile?: {
    firstName: string | null;
    lastName: string | null;
  } | null;
}

/** Отображаемое имя пользователя: имя и фамилия профиля, иначе email. */
export const userDisplayName = (
  user: IUserNameSource | null | undefined,
): string | null => {
  if (!user) return null;

  return (
    [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || user.email
  );
};

/** Связи пользователя для отображаемого имени (`relations` в find). */
export const USER_NAME_RELATIONS = { profile: true } as const;

/**
 * Присоединить пользователя по связи `relation` под псевдонимом `alias` —
 * только поля отображаемого имени (email и имя профиля).
 */
export const joinUserName = <T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  relation: string,
  alias: string,
): SelectQueryBuilder<T> =>
  qb
    .leftJoin(relation, alias)
    .addSelect([`${alias}.id`, `${alias}.email`])
    .leftJoin(`${alias}.profile`, `${alias}Profile`)
    .addSelect([
      `${alias}Profile.id`,
      `${alias}Profile.firstName`,
      `${alias}Profile.lastName`,
    ]);
