import { inject } from "inversify";

import { config } from "../../config";
import { hashPassword, IBootstrap, Injectable, logger } from "../../core";
import { HttpException } from "../../core/http";
import { RoleService } from "../role";
import { UserError } from "./user.errors";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

/**
 * Засеивает права/роли и создаёт администратора из конфига. Идемпотентен:
 * существующий администратор (в том числе созданный параллельной репликой)
 * не считается ошибкой, прочие ошибки БД пробрасываются.
 */
@Injectable()
export class AdminBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(UserService) private readonly _userService: UserService,
    @inject(UserRepository) private readonly _userRepository: UserRepository,
    @inject(RoleService) private readonly _roleService: RoleService,
  ) {}

  async initialize(): Promise<void> {
    await this._roleService.seedDefaultPermissions();

    const { email, password } = config.auth.admin;

    if (await this._userRepository.findByEmailOrPhone(email)) return;

    try {
      await this._userService.createAdmin({
        email,
        passwordHash: await hashPassword(password),
        emailVerified: true,
      });

      logger.info({ email }, "Администратор создан");
    } catch (err) {
      // Администратора успела создать параллельная реплика.
      if (
        err instanceof HttpException &&
        (err.code === UserError.codes.ALREADY_EXISTS || err.status === 409)
      ) {
        return;
      }

      throw err;
    }
  }
}
