import { IPaginatedDto } from "../../../core";
import { BaseDto } from "../../../core/dto/BaseDto";
import { UserDto } from "../../user/dto";
import { Profile } from "../profile.entity";

/** Профиль владельца. */
export class ProfileDto extends BaseDto {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  gender: string | null;
  locale: string | null;
  createdAt: Date;
  updatedAt: Date;

  user?: UserDto;

  constructor(entity: Profile) {
    super(entity);

    this.id = entity.id;
    this.userId = entity.userId;
    this.firstName = entity.firstName;
    this.lastName = entity.lastName;
    this.birthDate = entity.birthDate;
    this.gender = entity.gender;
    this.locale = entity.locale ?? null;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;

    this.user = entity.user ? UserDto.fromEntity(entity.user) : undefined;
  }

  static fromEntity(entity: Profile) {
    return new ProfileDto(entity);
  }
}

/** Профиль глазами другого пользователя. */
export class PublicProfileDto extends BaseDto {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;

  constructor(entity: Profile) {
    super(entity);

    this.id = entity.id;
    this.userId = entity.userId;
    this.firstName = entity.firstName;
    this.lastName = entity.lastName;
  }

  static fromEntity(entity: Profile) {
    return new PublicProfileDto(entity);
  }
}

export interface IProfileListDto extends IPaginatedDto<PublicProfileDto> {}
