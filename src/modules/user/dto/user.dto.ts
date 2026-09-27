import { IPaginatedDto } from "../../../core";
import { BaseDto } from "../../../core/dto/BaseDto";
import { IPermissionDto } from "../../permission/permission.dto";
import { ProfileDto } from "../../profile/dto";
import { IRoleDto } from "../../role/role.dto";
import { User } from "../user.entity";

/** Пользователь для владельца и администрирования. */
export class UserDto extends BaseDto {
  id: string;
  email: string | null;
  emailVerified?: boolean;
  phone: string | null;
  username: string | null;
  profile?: ProfileDto;
  roles: IRoleDto[];
  directPermissions: IPermissionDto[];
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: User) {
    super(entity);

    this.id = entity.id;
    this.email = entity.email;
    this.emailVerified = entity.emailVerified;
    this.phone = entity.phone;
    this.username = entity.username;
    this.profile = entity.profile && ProfileDto.fromEntity(entity.profile);
    this.roles = entity.roles?.map(r => r.toDTO()) ?? [];
    this.directPermissions =
      entity.directPermissions?.map(p => p.toDTO()) ?? [];
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: User) {
    return new UserDto(entity);
  }
}

/** Список пользователей для администрирования (`user:view`). */
export interface IUserAdminListDto extends IPaginatedDto<UserDto> {}

export interface IUserOptionDto {
  id: string;
  name: string | null;
}

export interface IUserOptionsDto {
  data: IUserOptionDto[];
}
