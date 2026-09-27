import { PermissionName } from "../../permission/permission.types";
import { RoleName } from "../role.types";

export interface IRolePermissionsRequestDto {
  permissions: PermissionName[];
}

export interface ICreateRoleRequestDto {
  name: RoleName;
}
