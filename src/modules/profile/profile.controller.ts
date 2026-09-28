import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
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
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IProfileListDto,
  IProfileUpdateRequestDto,
  ProfileDto,
  PublicProfileDto,
} from "./dto";
import { ProfileService } from "./profile.service";
import { ProfileListQuerySchema, UpdateProfileSchema } from "./validation";

@Injectable()
@Tags("Profile")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/profile")
export class ProfileController extends Controller {
  constructor(@inject(ProfileService) private _profileService: ProfileService) {
    super();
  }

  /**
   * Получить профиль текущего пользователя.
   * Этот эндпоинт позволяет получить данные профиля пользователя, который выполнил запрос.
   * Используется для получения информации о текущем пользователе, например, его имени, email, и других данных.
   *
   * @summary Получение профиля текущего пользователя
   * @returns Пользователь
   */
  @Security("jwt")
  @Get("my")
  async getMyProfile(@Request() req: KoaRequest): Promise<ProfileDto> {
    const user = getContextUser(req);
    const profile = await this._profileService.getProfileByUserId(user.userId);

    return this._profileService.toProfileDto(profile);
  }

  /**
   * Обновить профиль текущего пользователя.
   * Этот эндпоинт позволяет пользователю обновить свои данные, такие как имя, email и другие параметры профиля.
   *
   * @summary Обновление профиля текущего пользователя
   * @param body Обновленные данные профиля
   * @returns Обновленный профиль пользователя
   */
  @Security("jwt")
  @Patch("/my/update")
  @ValidateBody(UpdateProfileSchema)
  async updateMyProfile(
    @Request() req: KoaRequest,
    @Body() body: IProfileUpdateRequestDto,
  ): Promise<ProfileDto> {
    const user = getContextUser(req);
    const profile = await this._profileService.updateProfile(user.userId, body);

    return this._profileService.toProfileDto(profile);
  }

  /**
   * Очистить профиль текущего пользователя.
   * Личные данные (имя, фамилия, дата рождения, пол) обнуляются,
   * сама запись профиля остаётся.
   *
   * @summary Очистка профиля текущего пользователя
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Delete("my/delete")
  async deleteMyProfile(@Request() req: KoaRequest): Promise<void> {
    const user = getContextUser(req);

    await this._profileService.deleteProfile(user.userId);
  }

  /**
   * Получить все профили постранично, новые первыми.
   *
   * @summary Получение всех профилей
   * @param offset Смещение, по умолчанию 0
   * @param limit Размер страницы: по умолчанию 20, не больше 100
   * @returns Страница профилей
   */
  @Security("jwt", ["permission:profile:view"])
  @Get("all")
  @ValidateQuery(ProfileListQuerySchema)
  getProfiles(
    @Query("offset") offset?: number,
    @Query("limit") limit?: number,
  ): Promise<IProfileListDto> {
    return this._profileService.getProfiles(offset, limit);
  }

  /**
   * Получить профиль по ID.
   * Этот эндпоинт позволяет получить профиль другого пользователя по его ID. Доступен только для администраторов.
   *
   * @summary Получение профиля по ID
   * @param userId ID пользователя, профиль которого нужно получить
   * @returns Пользователь по ID
   */
  @Security("jwt")
  @Get("/{userId}")
  async getProfileById(@Path() userId: UUID): Promise<PublicProfileDto> {
    const profile = await this._profileService.getProfileByUserId(userId);

    return this._profileService.toPublicProfileDto(profile);
  }

  /**
   * Обновить профиль другого пользователя.
   * Этот эндпоинт позволяет администраторам обновлять профиль других пользователей.
   *
   * @summary Обновление профиля другого пользователя
   * @param userId ID пользователя, профиль которого необходимо обновить
   * @param body Данные для обновления профиля
   * @returns Обновленный профиль пользователя
   */
  @Security("jwt", ["permission:profile:update"])
  @Patch("update/{userId}")
  @ValidateBody(UpdateProfileSchema)
  async updateProfile(
    @Request() req: KoaRequest,
    @Path() userId: UUID,
    @Body() body: IProfileUpdateRequestDto,
  ): Promise<ProfileDto> {
    const profile = await this._profileService.updateProfileOf(
      getContextUser(req),
      userId,
      body,
    );

    return this._profileService.toProfileDto(profile);
  }

  /**
   * Очистить профиль другого пользователя.
   * Личные данные обнуляются, запись профиля остаётся.
   *
   * @summary Очистка профиля другого пользователя
   * @param userId ID пользователя, профиль которого необходимо очистить
   */
  @Security("jwt", ["permission:profile:delete"])
  @SuccessResponse(204, "No Content")
  @Delete("delete/{userId}")
  async deleteProfile(
    @Request() req: KoaRequest,
    @Path() userId: UUID,
  ): Promise<void> {
    await this._profileService.clearProfileOf(getContextUser(req), userId);
  }
}
