import { ownPermission } from "../../core/auth/has-permission";
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
  /**
   * Действие над сущностью с владельцем: кроме права на все сущности
   * объявляется `<name>:own` — только на свои (владелец или создатель).
   */
  scoped?: boolean;
}

/** Право в каталоге; `own` — имя права «только на свои», если оно есть. */
export interface IPermissionCatalogItem {
  name: string;
  label: string;
  own?: string;
}

/** Группа прав в каталоге (обычно — одна сущность домена). */
export interface IPermissionGroupDefinition {
  /** `<domain>` или `<domain>:<сущность>`; права группы начинаются с него. */
  key: string;
  label: string;
}

/** Группа каталога: подпись и права в порядке объявления. */
export interface IPermissionCatalogGroup extends IPermissionGroupDefinition {
  permissions: IPermissionCatalogItem[];
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

interface IRegisteredPermission {
  label: string;
  scoped: boolean;
}

interface IRegisteredGroup {
  domain: string;
  label: string;
  permissions: Map<string, IRegisteredPermission>;
}

/** Ключ группы → права, объявленные модулями через `definePermissions`. */
const registry = new Map<string, IRegisteredGroup>();

type PermissionNames<T extends Record<string, IPermissionDefinition>> = {
  readonly [K in keyof T]: T[K]["name"];
};

const assertValid = (
  domain: string,
  group: IPermissionGroupDefinition,
  definitions: IPermissionDefinition[],
): void => {
  const groupValid =
    DOMAIN_RE.test(domain) &&
    (group.key === domain || group.key.startsWith(`${domain}:`)) &&
    group.label.trim().length > 0;

  if (!groupValid) {
    throw PermissionError.INVALID_DEFINITION({ domain, group: group.key });
  }

  for (const { name, scoped } of definitions) {
    const longest = scoped ? ownPermission(name) : name;

    if (
      !name.startsWith(`${group.key}:`) ||
      !NAME_RE.test(name) ||
      longest.length > MAX_NAME_LENGTH ||
      (scoped && (name.endsWith(":*") || name.endsWith(":own")))
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
 * Каждое право — `<group.key>:<действие>`. Право с `scoped: true` объявляет
 * и `<имя>:own` — действие только над своими сущностями. Повторное объявление
 * тех же имён идемпотентно; подпись — последняя объявленная.
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
    entries.map(([, def]) => def),
  );

  const registered = registry.get(group.key) ?? {
    domain,
    label: group.label,
    permissions: new Map<string, IRegisteredPermission>(),
  };

  registered.label = group.label;
  entries.forEach(([, def]) =>
    registered.permissions.set(def.name, {
      label: def.label,
      scoped: def.scoped ?? false,
    }),
  );
  registry.set(group.key, registered);

  return Object.freeze(
    Object.fromEntries(entries.map(([key, def]) => [key, def.name])),
  ) as PermissionNames<T>;
};

const namesOf = (group: IRegisteredGroup): string[] =>
  [...group.permissions.entries()].flatMap(([name, { scoped }]) =>
    scoped ? [name, ownPermission(name)] : [name],
  );

/**
 * Все известные права: `*`, объявленные модулями и их варианты `:own`.
 * Отсортированы, без повторов.
 */
export const getRegisteredPermissions = (): string[] =>
  [
    ...new Set<string>([
      ALL_PERMISSIONS,
      ...[...registry.values()].flatMap(namesOf),
    ]),
  ].sort();

/** Каталог прав по группам в порядке объявления; первая — «Система». */
export const getPermissionCatalog = (): IPermissionCatalogGroup[] => [
  SYSTEM_GROUP,
  ...[...registry.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    permissions: [...group.permissions.entries()].map(
      ([name, { label, scoped }]) =>
        scoped ? { name, label, own: ownPermission(name) } : { name, label },
    ),
  })),
];

/** Права, объявленные для домена. */
export const getDomainPermissions = (domain: string): string[] =>
  [...registry.values()]
    .filter(group => group.domain === domain)
    .flatMap(namesOf);

/** Снять объявление домена. Только для тестов: реестр — глобальное состояние. */
export const unregisterPermissionDomain = (domain: string): void => {
  for (const [key, group] of registry) {
    if (group.domain === domain) registry.delete(key);
  }
};
