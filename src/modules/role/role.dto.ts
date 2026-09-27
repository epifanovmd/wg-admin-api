import { IPaginatedDto } from "../../core";
import { IPermissionDto } from "../permission/permission.dto";
import { TRole } from "./role.types";

export interface IRoleDto {
  id: string;
  name: TRole;
  createdAt: Date;
  updatedAt: Date;
  permissions: IPermissionDto[];
}

export interface IRoleListDto extends IPaginatedDto<IRoleDto> {}
