import { IPaginatedDto } from "../../core";
import { TPermission } from "./permission.types";

export interface IPermissionDto {
  id: string;
  name: TPermission;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPermissionListDto extends IPaginatedDto<IPermissionDto> {}
