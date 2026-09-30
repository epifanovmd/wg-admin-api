import { IPaginatedDto } from "../../core";
import { TPermission } from "./permission.types";

export interface IPermissionDto {
  id: string;
  name: TPermission;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPermissionListDto extends IPaginatedDto<IPermissionDto> {}

/** Право в каталоге: имя и подпись. */
export interface IPermissionCatalogItemDto {
  name: TPermission;
  label: string;
  /**
   * Право «только на свои» (владелец или создатель) для этого действия;
   * нет — действие без области.
   */
  own?: TPermission;
}

/** Группа прав каталога (обычно — сущность домена). */
export interface IPermissionCatalogGroupDto {
  /** `*`, `<домен>` или `<домен>:<сущность>`. */
  key: string;
  label: string;
  permissions: IPermissionCatalogItemDto[];
}

export interface IPermissionCatalogDto {
  groups: IPermissionCatalogGroupDto[];
}
