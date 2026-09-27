import { inject } from "inversify";
import { FindOptionsWhere } from "typeorm";

import {
  EventBus,
  Injectable,
  IPaginatedDto,
  normalizePagination,
  toPage,
} from "../../core";
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
}
