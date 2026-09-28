import { inject, multiInject, optional } from "inversify";
import {
  DataSource,
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  In,
} from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { normalizePhone } from "../../common";
import {
  EventBus,
  hashPassword,
  Injectable,
  IPaginatedDto,
  isSuperUser,
  isUniqueViolation,
  logger,
  normalizePagination,
  pgConstraint,
  toPage,
  verifyPassword,
} from "../../core";
import { ALL_PERMISSIONS } from "../../core/auth/superuser";
import { AuthContext } from "../../types/koa";
import { MailerService } from "../mailer";
import { OtpRepository, OtpService } from "../otp";
import { PermissionRepository } from "../permission";
import { Profile } from "../profile/profile.entity";
import { RoleRepository } from "../role";
import { Role } from "../role/role.entity";
import { Roles, TRole } from "../role/role.types";
import {
  IUserChangePasswordDto,
  IUserOptionDto,
  IUserPrivilegesRequestDto,
  IUserUpdateRequestDto,
  UserDto,
} from "./dto";
import { EmailChangeService } from "./email-change.service";
import {
  EmailVerifiedEvent,
  PasswordChangedEvent,
  UserDeletedEvent,
  UsernameChangedEvent,
  UserPrivilegesChangedEvent,
} from "./events";
import {
  IPasswordPolicy,
  IPasswordPolicyContext,
  PASSWORD_POLICY,
} from "./password-policy";
import { User } from "./user.entity";
import { UserError } from "./user.errors";
import { escapeLike, UserRepository } from "./user.repository";

/** Минимальный интервал между письмами с кодом подтверждения email. */
const VERIFY_EMAIL_RESEND_COOLDOWN_MS = 60_000;

/** Суперпользователь по данным из БД: роль ADMIN или право «*» (в роли или напрямую). */
const isSuperUserEntity = (user: User): boolean =>
  (user.roles ?? []).some(
    role =>
      role.name === Roles.ADMIN ||
      (role.permissions ?? []).some(p => p.name === ALL_PERMISSIONS),
  ) || (user.directPermissions ?? []).some(p => p.name === ALL_PERMISSIONS);

/** Сервис для управления пользователями: CRUD, права доступа, верификация email, смена пароля. */
@Injectable()
export class UserService {
  constructor(
    @inject(MailerService) private _mailerService: MailerService,
    @inject(OtpService) private _otpService: OtpService,
    @inject(OtpRepository) private _otpRepository: OtpRepository,
    @inject(UserRepository) private _userRepository: UserRepository,
    @inject(RoleRepository) private _roleRepository: RoleRepository,
    @inject(PermissionRepository)
    private _permissionRepository: PermissionRepository,
    @inject(DataSource) private _dataSource: DataSource,
    @inject(EventBus) private _eventBus: EventBus,
    @inject(EmailChangeService) private _emailChange: EmailChangeService,
    @multiInject(PASSWORD_POLICY)
    @optional()
    private _passwordPolicies: IPasswordPolicy[] | undefined = [],
  ) {}

  /** Страница пользователей для администрирования; фильтр по email. */
  async getUsers(
    offset?: number,
    limit?: number,
    query?: string,
  ): Promise<IPaginatedDto<UserDto>> {
    const page = normalizePagination(offset, limit);
    const [users, total] = await this._userRepository.findAndCount({
      where: query ? [{ email: ILike(`%${escapeLike(query)}%`) }] : undefined,
      relations: UserService.relations,
      skip: page.offset,
      take: page.limit,
      order: { createdAt: "DESC" },
    });

    return toPage(await this.toUserDtos(users), total, page);
  }

  toUserDtos(users: User[]): Promise<UserDto[]> {
    return Promise.resolve(users.map(user => UserDto.fromEntity(user)));
  }

  async toUserDto(user: User): Promise<UserDto> {
    const [dto] = await this.toUserDtos([user]);

    return dto;
  }

  /** Получить список пользователей в формате для выпадающего списка. */
  async getOptions(query?: string): Promise<IUserOptionDto[]> {
    return this._userRepository.findOptions(query);
  }

  /** Найти пользователя по email или телефону; иначе `USER_NOT_FOUND`. */
  async getUserByAttr(where: FindOptionsWhere<User>) {
    const user = await this._userRepository.findByEmailOrPhone(
      where.email as string,
      where.phone as string,
      UserService.relations,
    );

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    return user;
  }

  /** Получить пользователя по ID со всеми связями; иначе `USER_NOT_FOUND`. */
  async getUser(id: string) {
    const user = await this._userRepository.findOne({
      where: { id },
      relations: UserService.relations,
    });

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    return user;
  }

  /**
   * Создать пользователя с профилем и ролями (по умолчанию USER) в одной
   * транзакции. Занятый email/телефон → 409.
   */
  /** Пользователь с ролями и профилем (`profile` — имя, фамилия и т. п.). */
  async createUser(
    body: Partial<User>,
    roles: TRole[] = [Roles.USER],
    profile: Partial<Pick<Profile, "firstName" | "lastName">> = {},
  ) {
    try {
      const userId = await this._dataSource.transaction(async manager => {
        const found = await manager
          .getRepository(Role)
          .find({ where: { name: In(roles) } });

        if (found.length !== roles.length) {
          throw UserError.DEFAULT_ROLE_MISSING({ roles });
        }

        const userRepo = manager.getRepository(User);
        const savedUser = await userRepo.save(
          userRepo.create({ ...body, roles: found }),
        );

        const profileRepo = manager.getRepository(Profile);

        await profileRepo.save(
          profileRepo.create({ ...profile, userId: savedUser.id }),
        );

        return savedUser.id;
      });

      return this.getUser(userId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw UserError.ALREADY_EXISTS();
      }

      throw err;
    }
  }

  /** Создать пользователя с ролью ADMIN; существующий — `USER_ALREADY_EXISTS`. */
  async createAdmin(body: Partial<User>) {
    const existingUser = await this._userRepository.findByEmailOrPhone(
      body.email ?? undefined,
      body.phone ?? undefined,
    );

    if (existingUser) {
      throw UserError.ALREADY_EXISTS();
    }

    return this.createUser(body, [Roles.ADMIN]);
  }

  /**
   * Изменение email/телефона самим пользователем. Телефон меняется сразу.
   * Email — только после подтверждения (`confirmEmailChange`): здесь
   * создаётся запрос, код уходит на новый адрес, уведомление — на старый.
   * Занятые адреса → `USER_EMAIL_TAKEN` / `USER_PHONE_TAKEN`.
   */
  async updateMyUser(userId: string, body: IUserUpdateRequestDto) {
    const user = await this._userRepository.findById(userId);

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    const phone = body.phone ? normalizePhone(body.phone) : undefined;
    const phoneChanged = !!phone && phone !== user.phone;

    if (phoneChanged) {
      await this._assertAvailable(userId, undefined, phone);
    }

    if (body.email) {
      await this._emailChange.request(userId, body.email);
    }

    if (phoneChanged) {
      await this._applyContactPatch(userId, { phone });
    }

    return this.getUser(userId);
  }

  /** Подтвердить смену email кодом из письма, отправленного на новый адрес. */
  async confirmEmailChange(userId: string, code: string) {
    await this._emailChange.confirm(userId, code);

    return this.getUser(userId);
  }

  /**
   * Изменение email/телефона администратором — сразу, без подтверждения.
   * Новый email сбрасывает `emailVerified` и получает код подтверждения.
   * Суперпользователя меняет только суперпользователь.
   */
  async updateUser(
    actor: AuthContext,
    id: string,
    body: IUserUpdateRequestDto,
  ) {
    const user = await this._userRepository.findById(id, {
      profile: true,
      roles: { permissions: true },
      directPermissions: true,
    });

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    if (isSuperUserEntity(user) && !isSuperUser(actor)) {
      throw UserError.SUPERUSER_EDIT();
    }

    const patch: QueryDeepPartialEntity<User> = {};
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone ? normalizePhone(body.phone) : undefined;
    const emailChanged = !!email && email !== user.email;

    if (emailChanged) {
      patch.email = email;
      patch.emailVerified = false;
    }

    if (phone && phone !== user.phone) {
      patch.phone = phone;
    }

    if (Object.keys(patch).length === 0) {
      return this.getUser(id);
    }

    await this._assertAvailable(
      id,
      patch.email as string | undefined,
      patch.phone as string | undefined,
    );
    await this._applyContactPatch(id, patch);

    if (emailChanged && email) {
      // Письмо — побочный эффект: сбой почты не отменяет уже сохранённый email.
      await this._sendVerificationCode(
        id,
        email,
        user.profile?.locale ?? null,
      ).catch(err =>
        logger.warn(
          { err, userId: id },
          "Не удалось отправить код подтверждения на новый email",
        ),
      );
    }

    return this.getUser(id);
  }

  /** Обновить 2FA credentials пользователя. */
  async update2FA(
    userId: string,
    twoFactorHash: string | null,
    twoFactorHint: string | null,
  ): Promise<void> {
    await this._userRepository.update(userId, {
      twoFactorHash,
      twoFactorHint,
    });
  }

  /**
   * Заменить роли и прямые разрешения пользователя.
   *
   * - Роли и разрешения должны существовать — «на лету» не создаются.
   * - Менять собственные привилегии нельзя.
   * - Выдать роль `admin` / право `*` (в том числе через роль) и менять
   *   привилегии суперпользователя может только суперпользователь.
   *
   * Эффективные разрешения в JWT = объединение(role.permissions) ∪ permissions.
   */
  async setPrivileges(
    actor: AuthContext,
    userId: string,
    body: IUserPrivilegesRequestDto,
  ): Promise<User> {
    if (actor.userId === userId) {
      throw UserError.OWN_PRIVILEGES();
    }

    const user = await this._userRepository.findById(userId, {
      roles: { permissions: true },
      directPermissions: true,
    });

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    const roleNames = [...new Set(body.roles)];
    const permissionNames = [...new Set(body.permissions)];

    const roles = await this._roleRepository.findByNames(roleNames);
    const missingRoles = roleNames.filter(
      name => !roles.some(r => r.name === name),
    );

    if (missingRoles.length) {
      throw UserError.ROLES_NOT_FOUND(
        { roles: missingRoles },
        `Роли не найдены: ${missingRoles.join(", ")}`,
      );
    }

    const permissions =
      await this._permissionRepository.findByNames(permissionNames);
    const missingPermissions = permissionNames.filter(
      name => !permissions.some(p => p.name === name),
    );

    if (missingPermissions.length) {
      throw UserError.PERMISSIONS_NOT_FOUND(
        { permissions: missingPermissions },
        `Разрешения не найдены: ${missingPermissions.join(", ")}`,
      );
    }

    if (!isSuperUser(actor)) {
      const grantsSuper = isSuperUserEntity({
        ...user,
        roles,
        directPermissions: permissions,
      } as User);

      if (grantsSuper || isSuperUserEntity(user)) {
        throw UserError.SUPERUSER_ONLY();
      }
    }

    user.roles = roles;
    user.directPermissions = permissions;

    await this._userRepository.save(user);

    // Ждём слушателей: права запечены в токены — к ответу сессии обновлены.
    await this._eventBus.emitAsync(
      new UserPrivilegesChangedEvent(userId, roleNames, permissionNames),
    );

    return this.getUser(userId);
  }

  /** Права роли изменились — оповестить каждого её пользователя. */
  async notifyRoleMembersPrivilegesChanged(roleId: string): Promise<void> {
    const users = await this._userRepository.findByRoleId(roleId);

    await this._emitPrivilegesChanged(users);
  }

  /** Права пользователей изменились вне их записей (например, удалена роль). */
  async notifyUsersPrivilegesChanged(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const users = await this._userRepository.find({
      where: { id: In(userIds) },
      relations: { roles: true, directPermissions: true },
    });

    await this._emitPrivilegesChanged(users);
  }

  private async _emitPrivilegesChanged(users: User[]): Promise<void> {
    for (const user of users) {
      await this._eventBus.emitAsync(
        new UserPrivilegesChangedEvent(
          user.id,
          user.roles.map(r => r.name),
          user.directPermissions.map(p => p.name),
        ),
      );
    }
  }

  /** Отправить код подтверждения email; повторно — не чаще раза в минуту. */
  async requestVerifyEmail(userId: string): Promise<void> {
    const user = await this.getUser(userId);

    if (user.emailVerified) {
      throw UserError.EMAIL_ALREADY_VERIFIED();
    }

    if (!user.email) {
      throw UserError.EMAIL_MISSING();
    }

    const previous = await this._otpRepository.findByUserId(userId);
    const elapsed = previous
      ? Date.now() - previous.updatedAt.getTime()
      : Infinity;

    if (elapsed < VERIFY_EMAIL_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (VERIFY_EMAIL_RESEND_COOLDOWN_MS - elapsed) / 1000,
      );

      throw UserError.VERIFY_EMAIL_TOO_FREQUENT(
        { retryAfterSeconds: waitSeconds },
        `Повторно запросить код можно через ${waitSeconds} с.`,
      );
    }

    await this._sendVerificationCode(
      userId,
      user.email,
      user.profile?.locale ?? null,
    );
  }

  /** Подтвердить email пользователя с помощью OTP-кода. */
  async verifyEmail(userId: string, code: string): Promise<void> {
    const user = await this.getUser(userId);

    if (user.emailVerified) {
      throw UserError.EMAIL_ALREADY_VERIFIED();
    }

    await this._otpService.check(userId, code);
    await this._userRepository.update(userId, { emailVerified: true });

    this._eventBus.emit(new EmailVerifiedEvent(userId));
  }

  /**
   * Смена пароля самим пользователем: нужен текущий пароль. Остальные
   * сессии завершаются по `PasswordChangedEvent`, текущая — остаётся.
   */
  async changeOwnPassword(
    userId: string,
    currentSessionId: string,
    body: IUserChangePasswordDto,
  ): Promise<void> {
    const user = await this._userRepository.findById(userId);

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw UserError.WRONG_CURRENT_PASSWORD();
    }

    await this._validatePassword(body.newPassword, {
      userId,
      email: user.email,
      username: user.username,
    });

    await this._userRepository.update(userId, {
      passwordHash: await hashPassword(body.newPassword),
    });

    // Ждём слушателей: другие сессии отозваны к моменту ответа.
    await this._eventBus.emitAsync(
      new PasswordChangedEvent(userId, "change", currentSessionId),
    );
  }

  /**
   * Записать новый пароль без проверок и событий — для сброса по токену,
   * где событие эмитит вызывающий сценарий.
   */
  async changePassword(userId: string, password: string): Promise<void> {
    await this._userRepository.update(userId, {
      passwordHash: await hashPassword(password),
    });
  }

  /** Удалить собственный аккаунт; требуется пароль. */
  async deleteMyUser(userId: string, password: string): Promise<void> {
    const user = await this._userRepository.findById(userId);

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      throw UserError.WRONG_PASSWORD();
    }

    await this._delete(userId);
  }

  /** Удалить другого пользователя. Себя и суперпользователя — нельзя. */
  async deleteUserByAdmin(actor: AuthContext, userId: string): Promise<void> {
    if (actor.userId === userId) {
      throw UserError.SELF_DELETE_VIA_ADMIN();
    }

    const user = await this._userRepository.findById(userId, {
      roles: { permissions: true },
      directPermissions: true,
    });

    if (!user) {
      throw UserError.NOT_FOUND();
    }

    if (isSuperUserEntity(user)) {
      throw UserError.SUPERUSER_DELETE();
    }

    await this._delete(userId);
  }

  /** Установить username для пользователя. */
  async setUsername(userId: string, username: string) {
    if (!/^[a-z0-9_]{5,32}$/.test(username)) {
      throw UserError.USERNAME_INVALID();
    }

    const existing = await this._userRepository.findByUsername(username);

    if (existing && existing.id !== userId) {
      throw UserError.USERNAME_TAKEN();
    }

    await this._userRepository.update(userId, { username });

    this._eventBus.emit(new UsernameChangedEvent(userId, username));

    return this.getUser(userId);
  }

  /** Стандартный набор связей, загружаемых при запросах пользователя. */
  static get relations(): FindOptionsRelations<User> {
    return {
      profile: true,
      roles: {
        permissions: true,
      },
      directPermissions: true,
    };
  }

  /**
   * Код, который не удалось поставить в очередь писем, отзывается — иначе
   * он держал бы cooldown.
   */
  private async _sendVerificationCode(
    userId: string,
    email: string,
    locale: string | null,
  ) {
    const otp = await this._otpService.create(userId);

    try {
      await this._mailerService.sendCodeMail(email, otp.code, { locale });
    } catch (err) {
      await this._otpRepository.delete({ userId });
      throw err;
    }
  }

  /** Другой пользователь уже занял email или телефон → 409 с точным кодом. */
  private async _assertAvailable(
    userId: string,
    email?: string,
    phone?: string,
  ): Promise<void> {
    const conflicting = await this._userRepository.findConflicting(
      userId,
      email,
      phone,
    );

    if (!conflicting) return;

    throw email && (!phone || conflicting.email === email)
      ? UserError.EMAIL_TAKEN()
      : UserError.PHONE_TAKEN();
  }

  /** Сохранить email/телефон; гонка за уникальный индекс → 409. */
  private async _applyContactPatch(
    userId: string,
    patch: QueryDeepPartialEntity<User>,
  ): Promise<void> {
    try {
      await this._userRepository.update(userId, patch);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;

      const constraint = pgConstraint(err) ?? "";

      throw constraint.includes("PHONE") || !patch.email
        ? UserError.PHONE_TAKEN()
        : UserError.EMAIL_TAKEN();
    }
  }

  /** Политики пароля, зарегистрированные другими модулями (auth). */
  private async _validatePassword(
    password: string,
    context: IPasswordPolicyContext,
  ): Promise<void> {
    for (const policy of this._passwordPolicies ?? []) {
      await policy.validate(password, context);
    }
  }

  /** Событие — только если запись действительно удалена. */
  private async _delete(userId: string): Promise<void> {
    const deleted = await this._userRepository.delete(userId);

    if (!deleted.affected) {
      throw UserError.NOT_FOUND();
    }

    // Ждём слушателей: токены и сокеты удалённого отозваны к моменту ответа.
    await this._eventBus.emitAsync(new UserDeletedEvent(userId));
  }
}
