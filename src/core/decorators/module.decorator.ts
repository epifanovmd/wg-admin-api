import type { ServiceIdentifier } from "inversify";

import { IBootstrap } from "../bootstrap";

type Constructor<T = any> = new (...args: any[]) => T;

/** Класс TypeORM-сущности (`@Entity`). */
export type EntityClass = Function;

/**
 * Конфигурация провайдера с токеном.
 * Используется для multi-bind и привязок по интерфейс-символу.
 */
export interface TokenProvider<T = any> {
  provide: ServiceIdentifier<T>;
  useClass: Constructor<T>;
}

/**
 * Провайдер модуля — либо класс (bind to self), либо token-binding.
 */
export type ModuleProvider = Constructor | TokenProvider;

export interface ModuleOptions {
  /** Другие модули, чьи провайдеры будут доступны в этом модуле */
  imports?: Constructor[];
  /**
   * Сущности модуля. Схема БД собирается из них явно — без поиска файлов
   * по маске: незарегистрированная сущность не попадёт в DataSource, и
   * тест реестра на это укажет.
   */
  entities?: EntityClass[];
  /** Сервисы и классы, регистрируемые в IoC контейнере */
  providers?: ModuleProvider[];
  /** Bootstrapper-классы, реализующие IBootstrap */
  bootstrappers?: Constructor<IBootstrap>[];
}

export const MODULE_METADATA_KEY = "module:metadata";

/**
 * Декоратор модуля, определяет границы фичи и регистрирует провайдеры.
 * Вдохновлён подходом NestJS, но реализован нативно через inversify.
 *
 * @example
 * @Module({
 *   imports: [DatabaseModule],
 *   entities: [User],
 *   providers: [UserService, { provide: SOCKET_HANDLER, useClass: UserSocketHandler }],
 *   bootstrappers: [AdminBootstrap],
 * })
 * export class UserModule {}
 */
export const Module = (options: ModuleOptions = {}): ClassDecorator => {
  return (target: Function) => {
    Reflect.defineMetadata(MODULE_METADATA_KEY, options, target);
  };
};

export const getModuleOptions = (target: Function): ModuleOptions =>
  Reflect.getMetadata(MODULE_METADATA_KEY, target) ?? {};

/**
 * Дерево модулей в порядке загрузки: импорты раньше импортёра, без дублей.
 */
export const collectModules = (root: Constructor): Constructor[] => {
  const ordered: Constructor[] = [];
  const seen = new Set<Constructor>();
  const visit = (module: Constructor) => {
    if (seen.has(module)) return;

    seen.add(module);
    getModuleOptions(module).imports?.forEach(visit);
    ordered.push(module);
  };

  visit(root);

  return ordered;
};

/** Все сущности дерева модулей — для DataSource. */
export const collectEntities = (root: Constructor): EntityClass[] => [
  ...new Set(
    collectModules(root).flatMap(m => getModuleOptions(m).entities ?? []),
  ),
];

export const isTokenProvider = (p: ModuleProvider): p is TokenProvider => {
  return typeof p === "object" && "provide" in p && "useClass" in p;
};
