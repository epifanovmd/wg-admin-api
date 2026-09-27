import { defineErrors } from "../../core/http";
import { Permissions } from "./permission.types";

export const PermissionError = defineErrors("PERMISSION", {
  INVALID_DEFINITION: {
    status: 500,
    message: "Некорректное объявление прав модуля",
  },
});

const DOMAIN_RE = /^[a-z][a-z0-9-]*$/;
const NAME_RE = /^[a-z][a-z0-9-]*(:([a-z0-9-]+|\*))+$/;
const MAX_NAME_LENGTH = 100;

/** Домен → права, объявленные модулями через `definePermissions`. */
const registry = new Map<string, Set<string>>();

/**
 * Объявить права модуля. Модуль держит свои права у себя, засев ролей
 * (`RoleService.seedDefaultPermissions`) собирает все объявленные — общий
 * файл при добавлении модуля не правится.
 *
 * Каждое право — `<domain>:<действие>` (или `<domain>:*`). Повторное
 * объявление тех же имён идемпотентно.
 *
 * @example
 * export const ChatPermissions = definePermissions("chat", {
 *   VIEW: "chat:view",
 *   MANAGE: "chat:manage",
 * });
 */
export const definePermissions = <const T extends Record<string, string>>(
  domain: string,
  permissions: T,
): Readonly<T> => {
  if (!DOMAIN_RE.test(domain)) {
    throw PermissionError.INVALID_DEFINITION({ domain });
  }

  const names = Object.values(permissions);

  for (const name of names) {
    if (
      !name.startsWith(`${domain}:`) ||
      !NAME_RE.test(name) ||
      name.length > MAX_NAME_LENGTH
    ) {
      throw PermissionError.INVALID_DEFINITION({ domain, name });
    }
  }

  const declared = registry.get(domain) ?? new Set<string>();

  names.forEach(name => declared.add(name));
  registry.set(domain, declared);

  return Object.freeze({ ...permissions });
};

/**
 * Все известные права: `*`, совместимый справочник `Permissions` и
 * объявленные модулями. Отсортированы, без повторов.
 */
export const getRegisteredPermissions = (): string[] =>
  [
    ...new Set<string>([
      ...Object.values(Permissions),
      ...[...registry.values()].flatMap(names => [...names]),
    ]),
  ].sort();

/** Права, объявленные для домена (без совместимого справочника). */
export const getDomainPermissions = (domain: string): string[] => [
  ...(registry.get(domain) ?? []),
];

/** Снять объявление домена. Только для тестов: реестр — глобальное состояние. */
export const unregisterPermissionDomain = (domain: string): void => {
  registry.delete(domain);
};
