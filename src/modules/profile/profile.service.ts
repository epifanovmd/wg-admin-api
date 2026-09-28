import { inject } from "inversify";
import { FindOptionsWhere } from "typeorm";

import {
  AccessService,
  EventBus,
  Injectable,
  IPaginatedDto,
  normalizePagination,
  toPage,
} from "../../core";
import { isSuperUser } from "../../core/auth/user-context";
import type { AuthContext } from "../../types/koa";
import { IProfileUpdateRequestDto, ProfileDto, PublicProfileDto } from "./dto";
import { ProfileUpdatedEvent } from "./events";
import { Profile } from "./profile.entity";
import { ProfileError } from "./profile.errors";
import { ProfileRepository } from "./profile.repository";

/** Сервис для управления профилями пользователей. */
@Injectable()
export class ProfileService {
  constructor(
    @inject(ProfileRepository) private _profileRepository: ProfileRepository,
    @inject(EventBus) private _eventBus: EventBus,
    @inject(AccessService) private _access: AccessService,
  ) {}

  toProfileDto(profile: Profile): ProfileDto {
    return ProfileDto.fromEntity(profile);
  }

  toPublicProfileDto(profile: Profile): PublicProfileDto {
    return PublicProfileDto.fromEntity(profile);
  }

  /** Страница профилей, новые первыми; лимит по умолчанию и максимум — из `core`. */
  async getProfiles(
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<PublicProfileDto>> {
    const page = normalizePagination(offset, limit);
    const [items, total] = await this._profileRepository.findPage(page);

    return toPage(items.map(PublicProfileDto.fromEntity), total, page);
  }

  /** Найти профиль по произвольным условиям; иначе `PROFILE_NOT_FOUND`. */
  async getProfileByAttr(where: FindOptionsWhere<Profile>) {
    const profile = await this._profileRepository.findOne({
      where,
      relations: { user: true },
    });

    if (!profile) {
      throw ProfileError.NOT_FOUND();
    }

    return profile;
  }

  /** Получить профиль по идентификатору пользователя; иначе `PROFILE_NOT_FOUND`. */
  async getProfileByUserId(userId: string) {
    const profile = await this._profileRepository.findByUserId(userId);

    if (!profile) {
      throw ProfileError.NOT_FOUND();
    }

    return profile;
  }

  /** Обновить профиль пользователя и вернуть обновлённые данные. */
  async updateProfile(userId: string, body: IProfileUpdateRequestDto) {
    await this._profileRepository.update({ userId }, body);
    const profile = await this._profileRepository.findByUserId(userId);

    if (!profile) {
      throw ProfileError.NOT_FOUND();
    }

    this._eventBus.emit(
      new ProfileUpdatedEvent(this.toPublicProfileDto(profile)),
    );

    return profile;
  }

  /** Изменить чужой профиль; профиль суперпользователя — только суперпользователь. */
  async updateProfileOf(
    actor: AuthContext,
    userId: string,
    body: IProfileUpdateRequestDto,
  ) {
    await this._assertCanEdit(actor, userId);

    return this.updateProfile(userId, body);
  }

  /** Очистить чужой профиль; профиль суперпользователя — только суперпользователь. */
  async clearProfileOf(actor: AuthContext, userId: string): Promise<void> {
    await this._assertCanEdit(actor, userId);
    await this.deleteProfile(userId);
  }

  /**
   * «Удалить» профиль: очистить личные данные. Запись остаётся — профиль
   * существует у пользователя всегда (1:1 с `users`).
   */
  async deleteProfile(userId: string): Promise<void> {
    const cleared = await this._profileRepository.update(
      { userId },
      {
        firstName: null,
        lastName: null,
        birthDate: null,
        gender: null,
      },
    );

    if (!cleared.affected) {
      throw ProfileError.NOT_FOUND();
    }

    const profile = await this._profileRepository.findByUserId(userId);

    if (profile) {
      this._eventBus.emit(
        new ProfileUpdatedEvent(this.toPublicProfileDto(profile)),
      );
    }
  }

  private async _assertCanEdit(
    actor: AuthContext,
    userId: string,
  ): Promise<void> {
    if (!isSuperUser(actor) && (await this._access.isSuperUser(userId))) {
      throw ProfileError.SUPERUSER_EDIT();
    }
  }
}
