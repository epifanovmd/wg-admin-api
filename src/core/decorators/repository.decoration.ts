import { injectable } from "inversify";

/**
 * Ключ метаданных, по которому ModuleLoader определяет класс репозитория
 * и извлекает entity для toDynamicValue-биндинга через DataSource.
 */
export const REPOSITORY_ENTITY_KEY = "repository:entity";

/**
 * Маркирует класс как репозиторий TypeORM и сохраняет entity-класс в метаданных.
 * Регистрация в IoC контейнере происходит через ModuleLoader, когда класс
 * объявлен в @Module({ providers: [MyRepository] }).
 *
 * @example
 * @InjectableRepository(User)
 * export class UserRepository extends BaseRepository<User> {}
 *
 * // user.module.ts
 * @Module({ providers: [UserRepository, UserService] })
 * export class UserModule {}
 */
export const InjectableRepository = <T>(entity: new () => T) => {
  return <C extends new (...args: any[]) => any>(constructor: C) => {
    Reflect.defineMetadata(REPOSITORY_ENTITY_KEY, entity, constructor);

    return injectable()(constructor);
  };
};
