import { injectable } from "inversify";

/**
 * Маркирует класс как injectable для inversify.
 * Регистрация в IoC контейнере происходит через @Module({ providers: [...] }).
 *
 * @example
 * @Injectable()
 * export class UserService {
 *   constructor(@inject(UserRepository) private repo: UserRepository) {}
 * }
 */
export const Injectable = () => {
  return injectable();
};
