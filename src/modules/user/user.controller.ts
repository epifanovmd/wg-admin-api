import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import {
  getContextUser,
  Injectable,
  ThrottleGuard,
  UseGuards,
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IUserAdminListDto,
  IUserChangePasswordDto,
  IUserConfirmEmailChangeDto,
  IUserDeleteDto,
  IUserOptionsDto,
  IUserPrivilegesRequestDto,
  IUserUpdateRequestDto,
  IUserVerifyEmailDto,
  UserDto,
} from "./dto";
import { UserService } from "./user.service";
import {
  ChangePasswordSchema,
  ConfirmEmailChangeSchema,
  DeleteMyUserSchema,
  SetPrivilegesSchema,
  SetUsernameSchema,
  UserListQuerySchema,
  UserOptionsQuerySchema,
  UserUpdateSchema,
  VerifyEmailSchema,
} from "./validation";

@Injectable()
@Tags("User")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/user")
export class UserController extends Controller {
  constructor(@inject(UserService) private _userService: UserService) {
    super();
  }

  /**
   * Получить пользователя.
   * Этот эндпоинт позволяет получить данные пользователя, который выполнил запрос.
   *
   * @summary Получение данных текущего пользователя
   * @returns Пользователь
   */
  @Security("jwt")
  @Get("my")
  getMyUser(@Request() req: KoaRequest): Promise<UserDto> {
    const user = getContextUser(req);

    return this._userService
      .getUser(user.userId)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Обновить email и/или телефон текущего пользователя.
   * Телефон меняется сразу. Email — нет: создаётся запрос на смену, код
   * уходит на новый адрес, уведомление — на старый; адрес меняется после
   * `POST my/email/confirm`. Повторный запрос — не чаще раза в минуту (429).
   * Занятые email/телефон → 409 (`USER_EMAIL_TAKEN` / `USER_PHONE_TAKEN`).
   *
   * @summary Обновление данных текущего пользователя
   * @param body Обновленные данные пользователя
   * @returns Пользователь (email — прежний до подтверждения)
   */
  @Security("jwt")
  @Patch("/my/update")
  @ValidateBody(UserUpdateSchema)
  updateMyUser(
    @Request() req: KoaRequest,
    @Body() body: IUserUpdateRequestDto,
  ): Promise<UserDto> {
    const user = getContextUser(req);

    return this._userService
      .updateMyUser(user.userId, body)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Подтвердить смену email кодом из письма на новый адрес. Email
   * меняется и считается подтверждённым. Неверный код расходует попытку
   * (`USER_EMAIL_CHANGE_INVALID_CODE`, в `details.attemptsLeft` — остаток);
   * после 5 неверных или по истечении 15 минут запрос аннулируется.
   *
   * @summary Подтверждение смены email
   * @param body Код подтверждения
   * @returns Пользователь с новым email
   */
  @Security("jwt")
  @UseGuards(ThrottleGuard(10, 15 * 60_000, "user:email-change-confirm"))
  @Post("my/email/confirm")
  @ValidateBody(ConfirmEmailChangeSchema)
  confirmEmailChange(
    @Request() req: KoaRequest,
    @Body() body: IUserConfirmEmailChangeDto,
  ): Promise<UserDto> {
    const user = getContextUser(req);

    return this._userService
      .confirmEmailChange(user.userId, body.code)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Удалить текущего пользователя. Требуется текущий пароль.
   * POST, а не DELETE: тело DELETE-запроса не разбирается body-parser-ом.
   *
   * @summary Удаление текущего пользователя
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Post("my/delete")
  @ValidateBody(DeleteMyUserSchema)
  async deleteMyUser(
    @Request() req: KoaRequest,
    @Body() body: IUserDeleteDto,
  ): Promise<void> {
    const user = getContextUser(req);

    await this._userService.deleteMyUser(user.userId, body.password);
  }

  /**
   * Установить username для текущего пользователя.
   * @summary Установка username
   */
  @Security("jwt")
  @ValidateBody(SetUsernameSchema)
  @Patch("my/username")
  setUsername(
    @Request() req: KoaRequest,
    @Body() body: { username: string },
  ): Promise<UserDto> {
    const user = getContextUser(req);

    return this._userService
      .setUsername(user.userId, body.username)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Получить пользователей постранично (администрирование), новые первыми.
   *
   * @summary Получение всех пользователей
   * @param offset Смещение, по умолчанию 0
   * @param limit Размер страницы: по умолчанию 20, не больше 100
   * @param query Поиск по email, минимум 2 символа
   * @returns Страница пользователей
   */
  @Security("jwt", ["permission:user:view"])
  @Get("all")
  @ValidateQuery(UserListQuerySchema)
  getUsers(
    @Query("offset") offset?: number,
    @Query("limit") limit?: number,
    @Query("query") query?: string,
  ): Promise<IUserAdminListDto> {
    return this._userService.getUsers(offset, limit, query);
  }

  /**
   * Получить опции пользователей для выпадающих списков (id + name).
   * name — имя и фамилия или email если профиль не заполнен.
   *
   * @summary Опции пользователей
   * @param query Поиск по email, имени или фамилии
   * @returns Список опций
   */
  @Security("jwt", ["permission:user:view"])
  @Get("options")
  @ValidateQuery(UserOptionsQuerySchema)
  getUserOptions(@Query("query") query?: string): Promise<IUserOptionsDto> {
    return this._userService.getOptions(query).then(data => ({ data }));
  }

  /**
   * Получить пользователя по ID.
   *
   * @summary Получение пользователя по ID
   * @param id ID пользователя, которого нужно получить
   * @returns Пользователь по ID
   */
  @Security("jwt", ["permission:user:view"])
  @Get("/{id}")
  getUserById(@Path() id: UUID): Promise<UserDto> {
    return this._userService
      .getUser(id)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Установить роли и прямые права пользователя.
   * Роли и права должны существовать. Свои привилегии менять нельзя; роль
   * `admin` и право `*` выдаёт только суперпользователь.
   *
   * @summary Установка привилегий для пользователя
   * @param id ID пользователя, для которого необходимо установить привилегии
   * @param body Запрос, содержащий роль и разрешения
   * @returns Обновленный пользователь с привилегиями
   */
  @Security("jwt", ["permission:user:privileges"])
  @Patch("setPrivileges/{id}")
  @ValidateBody(SetPrivilegesSchema)
  setPrivileges(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUserPrivilegesRequestDto,
  ): Promise<UserDto> {
    return this._userService
      .setPrivileges(getContextUser(req), id, body)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Отправить код подтверждения на email текущего пользователя.
   * Повторная отправка — не чаще раза в минуту (429).
   *
   * @summary Запрос подтверждения email
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @UseGuards(ThrottleGuard(5, 15 * 60_000, "user:verify-email-request"))
  @Post("verify-email/request")
  async requestVerifyEmail(@Request() req: KoaRequest): Promise<void> {
    const user = getContextUser(req);

    await this._userService.requestVerifyEmail(user.userId);
  }

  /**
   * Подтвердить email текущего пользователя кодом из письма.
   *
   * @summary Подтверждение email-адреса
   * @param body Код подтверждения
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @UseGuards(ThrottleGuard(10, 15 * 60_000, "user:verify-email"))
  @Post("verify-email")
  @ValidateBody(VerifyEmailSchema)
  async verifyEmail(
    @Request() req: KoaRequest,
    @Body() body: IUserVerifyEmailDto,
  ): Promise<void> {
    const user = getContextUser(req);

    await this._userService.verifyEmail(user.userId, body.code);
  }

  /**
   * Обновить email/телефон другого пользователя — сразу, без подтверждения
   * кодом. Новый email сбрасывает `emailVerified`.
   *
   * @summary Обновление другого пользователя
   * @param id ID пользователя, которого необходимо обновить
   * @param body Данные для обновления пользователя
   * @returns Обновленный пользователь
   */
  @Security("jwt", ["permission:user:update"])
  @Patch("update/{id}")
  @ValidateBody(UserUpdateSchema)
  updateUser(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUserUpdateRequestDto,
  ): Promise<UserDto> {
    return this._userService
      .updateUser(getContextUser(req), id, body)
      .then(u => this._userService.toUserDto(u));
  }

  /**
   * Изменить пароль текущего пользователя. Требуется текущий пароль;
   * остальные сессии завершаются, текущая остаётся.
   *
   * @summary Изменение пароля
   * @param body Текущий и новый пароль
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @UseGuards(ThrottleGuard(5, 15 * 60_000, "user:change-password"))
  @Post("changePassword")
  @ValidateBody(ChangePasswordSchema)
  async changePassword(
    @Request() req: KoaRequest,
    @Body() body: IUserChangePasswordDto,
  ): Promise<void> {
    const user = getContextUser(req);

    await this._userService.changeOwnPassword(
      user.userId,
      user.sessionId,
      body,
    );
  }

  /**
   * Удалить другого пользователя. Себя и суперпользователя удалить нельзя.
   *
   * @summary Удаление другого пользователя
   * @param id ID пользователя, которого необходимо удалить
   */
  @Security("jwt", ["permission:user:delete"])
  @SuccessResponse(204, "No Content")
  @Delete("delete/{id}")
  async deleteUser(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._userService.deleteUserByAdmin(getContextUser(req), id);
  }
}
