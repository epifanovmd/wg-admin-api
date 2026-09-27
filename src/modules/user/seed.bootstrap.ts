import { inject } from "inversify";

import { isDevelopment } from "../../config";
import { hashPassword, IBootstrap, Injectable, logger } from "../../core";
import { ProfileRepository } from "../profile";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

/** Пароль демо-пользователей (только development). */
export const SEED_USER_PASSWORD = "test1234";

/** Демо-пользователи для локальной разработки. */
export const SEED_USERS = [
  {
    email: "alice@test.local",
    username: "alice",
    firstName: "Alice",
    lastName: "Johnson",
  },
  {
    email: "bob@test.local",
    username: "bob",
    firstName: "Bob",
    lastName: "Smith",
  },
  {
    email: "charlie@test.local",
    username: "charlie",
    firstName: "Charlie",
    lastName: "Brown",
  },
] as const;

/**
 * Демо-пользователи в development: alice, bob, charlie с подтверждённым
 * email. Идемпотентен — существующие пропускаются.
 */
@Injectable()
export class SeedBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(UserService) private readonly _userService: UserService,
    @inject(UserRepository) private readonly _userRepo: UserRepository,
    @inject(ProfileRepository) private readonly _profileRepo: ProfileRepository,
  ) {}

  async initialize(): Promise<void> {
    if (!isDevelopment) return;

    const passwordHash = await hashPassword(SEED_USER_PASSWORD);
    let created = 0;

    for (const u of SEED_USERS) {
      if (await this._userRepo.findByEmailOrPhone(u.email)) continue;

      try {
        const user = await this._userService.createUser({
          email: u.email,
          username: u.username,
          passwordHash,
          emailVerified: true,
        });

        await this._profileRepo.update(
          { userId: user.id },
          { firstName: u.firstName, lastName: u.lastName },
        );
        created += 1;
      } catch (err) {
        logger.warn(
          { err, email: u.email },
          "Не удалось создать демо-пользователя",
        );
      }
    }

    if (created > 0) logger.info({ created }, "Демо-пользователи созданы");
  }
}
