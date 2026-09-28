import { ALL_PERMISSIONS } from "../../core/auth/superuser";
import { defineErrors } from "../../core/http";

export const PermissionError = defineErrors("PERMISSION", {
  INVALID_DEFINITION: {
    status: 500,
    message: "Некорректное объявление прав модуля",
  },
});

/** Право в объявлении модуля: имя и подпись для редакторов ролей. */
export interface IPermissionDefinition {
  name: string;
  label: string;
}

/** Группа прав в каталоге (обычно — одна сущность домена). */
export interface IPermissionGroupDefinition {
  /** `<domain>` или `<domain>:<сущность>`; права группы начинаются с него. */
  key: string;
  label: string;
}

/** Группа каталога: подпись и права в порядке объявления. */
export interface IPermissionCatalogGroup extends IPermissionGroupDefinition {
  permissions: IPermissionDefinition[];
}

const DOMAIN_RE = /^[a-z][a-z0-9-]*$/;
const NAME_RE = /^[a-z][a-z0-9-]*(:([a-z0-9-]+|\*))+$/;
const MAX_NAME_LENGTH = 100;

/** Группа «Система»: полный доступ. */
const SYSTEM_GROUP: IPermissionCatalogGroup = {
  key: "*",
  label: "Система",
  permissions: [{ name: ALL_PERMISSIONS, label: "Полный доступ" }],
};

interface IRegisteredGroup {
  domain: string;
  label: string;
  permissions: Map<string, string>;
}

/** Ключ группы → права, объявленные модулями через `definePermissions`. */
const registry = new Map<string, IRegisteredGroup>();

type PermissionNames<T extends Record<string, IPermissionDefinition>> = {
  readonly [K in keyof T]: T[K]["name"];
};

const assertValid = (
  domain: string,
  group: IPermissionGroupDefinition,
  names: string[],
): void => {
  const groupValid =
    DOMAIN_RE.test(domain) &&
    (group.key === domain || group.key.startsWith(`${domain}:`)) &&
    group.label.trim().length > 0;

  if (!groupValid) {
    throw PermissionError.INVALID_DEFINITION({ domain, group: group.key });
  }

  for (const name of names) {
    if (
      !name.startsWith(`${group.key}:`) ||
      !NAME_RE.test(name) ||
      name.length > MAX_NAME_LENGTH
    ) {
      throw PermissionError.INVALID_DEFINITION({ domain, name });
    }
  }
};

/**
 * Объявить права модуля с подписями. Модуль держит свои права у себя: засев
 * (`RoleService.seedDefaultPermissions`) и каталог для редакторов ролей
 * собирают все объявленные — общий файл при добавлении модуля не правится.
 *
 * Каждое право — `<group.key>:<действие>`. Повторное объявление тех же имён
 * идемпотентно; подпись — последняя объявленная.
 *
 * @example
 * export const ReportPermissions = definePermissions(
 *   "report",
 *   { key: "report", label: "Отчёты" },
 *   {
 *     VIEW: { name: "report:view", label: "Просмотр" },
 *     EXPORT: { name: "report:export", label: "Выгрузка" },
 *   },
 * );
 */
export const definePermissions = <
  const T extends Record<string, IPermissionDefinition>,
>(
  domain: string,
  group: IPermissionGroupDefinition,
  permissions: T,
): PermissionNames<T> => {
  const entries = Object.entries(permissions);

  assertValid(
    domain,
    group,
    entries.map(([, def]) => def.name),
  );

  const registered = registry.get(group.key) ?? {
    domain,
    label: group.label,
    permissions: new Map<string, string>(),
  };

  registered.label = group.label;
  entries.forEach(([, def]) => registered.permissions.set(def.name, def.label));
  registry.set(group.key, registered);

  return Object.freeze(
    Object.fromEntries(entries.map(([key, def]) => [key, def.name])),
  ) as PermissionNames<T>;
};

/** Все известные права: `*` и объявленные модулями. Отсортированы, без повторов. */
export const getRegisteredPermissions = (): string[] =>
  [
    ...new Set<string>([
      ALL_PERMISSIONS,
      ...[...registry.values()].flatMap(group => [...group.permissions.keys()]),
    ]),
  ].sort();

/** Каталог прав по группам в порядке объявления; первая — «Система». */
export const getPermissionCatalog = (): IPermissionCatalogGroup[] => [
  SYSTEM_GROUP,
  ...[...registry.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    permissions: [...group.permissions.entries()].map(([name, label]) => ({
      name,
      label,
    })),
  })),
];

/** Права, объявленные для домена. */
export const getDomainPermissions = (domain: string): string[] =>
  [...registry.values()]
    .filter(group => group.domain === domain)
    .flatMap(group => [...group.permissions.keys()]);

/** Снять объявление домена. Только для тестов: реестр — глобальное состояние. */
export const unregisterPermissionDomain = (domain: string): void => {
  for (const [key, group] of registry) {
    if (group.domain === domain) registry.delete(key);
  }
};
