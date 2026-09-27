import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  ICreateRoleRequestDto,
  IRolePermissionsRequestDto,
} from "./dto/role-request.dto";
import { IRoleDto } from "./role.dto";
import { RoleService } from "./role.service";
import { SetRolePermissionsSchema } from "./validation";
import { CreateRoleSchema } from "./validation/create-role.validate";

@Injectable()
@Tags("Role")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/roles")
export class RoleController extends Controller {
  constructor(@inject(RoleService) private _roleService: RoleService) {
    super();
  }

  /**
   * Получить все роли с их правами.
   *
   * @summary Список ролей
   * @returns Список ролей
   */
  @Security("jwt", ["permission:role:view"])
  @Get()
  getRoles(): Promise<IRoleDto[]> {
    return this._roleService
      .getRoles()
      .then(roles => roles.map(r => r.toDTO()));
  }

  /**
   * Создать новую роль.
   *
   * @summary Создание роли
   * @param body Название роли
   * @returns Созданная роль
   */
  @Security("jwt", ["permission:role:manage"])
  @Post()
  @SuccessResponse(201, "Created")
  @ValidateBody(CreateRoleSchema)
  async createRole(@Body() body: ICreateRoleRequestDto): Promise<IRoleDto> {
    const role = await this._roleService.createRole(body.name);

    return role.toDTO();
  }

  /**
   * Удалить роль.
   *
   * @summary Удаление роли
   * @param id ID роли
   */
  @Security("jwt", ["permission:role:manage"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteRole(@Path() id: UUID): Promise<void> {
    await this._roleService.deleteRole(id);
  }

  /**
   * Установить права для роли.
   * Заменяет текущий набор прав роли указанным. Роль `admin`, право `*` и
   * собственную роль меняет только суперпользователь. Все пользователи роли
   * получают `user:privileges-changed`, их сессии завершаются.
   *
   * @summary Установка прав роли
   * @param id ID роли
   * @param body Список прав
   * @returns Обновлённая роль
   */
  @Security("jwt", ["permission:role:manage"])
  @Patch("{id}/permissions")
  @ValidateBody(SetRolePermissionsSchema)
  setRolePermissions(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IRolePermissionsRequestDto,
  ): Promise<IRoleDto> {
    return this._roleService
      .setRolePermissions(getContextUser(req), id, body.permissions)
      .then(r => r.toDTO());
  }
}
