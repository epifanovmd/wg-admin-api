import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto, IPaginatedDto } from "../../core";
import {
  getContextUser,
  Injectable,
  normalizePagination,
  ValidateBody,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { WgNodeCommandDto } from "../wg-node";
import {
  IAddWgInterfaceReplicaBody,
  IAssignWgInterfaceBody,
  ICreateWgInterfaceBody,
  IMoveWgInterfaceBody,
  IUpdateWgInterfaceBody,
  WgInterfaceDto,
  WgInterfaceOptionDto,
} from "./dto";
import {
  AddWgInterfaceReplicaSchema,
  AssignWgInterfaceSchema,
  CreateWgInterfaceSchema,
  MoveWgInterfaceSchema,
  UpdateWgInterfaceSchema,
} from "./validation";
import { WgInterfaceService } from "./wg-interface.service";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";

@Injectable()
@Tags("WgInterface")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/interfaces")
export class WgInterfaceController extends Controller {
  constructor(
    @inject(WgInterfaceService) private readonly _service: WgInterfaceService,
    @inject(WgInterfaceReplicaService)
    private readonly _replicas: WgInterfaceReplicaService,
  ) {
    super();
  }

  /**
   * Создать WireGuard-интерфейс на ноде; ключи генерируются на сервере,
   * приватный ключ хранится зашифрованным. Нода должна быть видна автору;
   * создатель — автор запроса, владелец, отличный от себя, — только с правом
   * `wg:interface:assign`. Произвольные PostUp/PostDown — с правом
   * `wg:interface:hooks`.
   * @summary Создание интерфейса
   */
  @Security("jwt", ["permission:wg:interface:create"])
  @ValidateBody(CreateWgInterfaceSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgInterface(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    return this._service.create(getContextUser(req), body);
  }

  /**
   * Интерфейсы с фильтрами (с копиями), новые первыми. `nodeId` — основная
   * нода, `hostNodeId` — нода, где интерфейс работает (основная или копия).
   * `viaRelay` — только
   * интерфейсы за точками через релей: что и куда пересылают релеи. С правом
   * `wg:interface:view:own` — только свои (владелец или создатель).
   * @summary Список интерфейсов
   */
  @Security("jwt", ["permission:wg:interface:view:own"])
  @Get()
  listWgInterfaces(
    @Request() req: KoaRequest,
    @Query() nodeId?: UUID,
    @Query() hostNodeId?: UUID,
    @Query() endpointId?: UUID,
    @Query() viaRelay?: boolean,
    @Query() enabled?: boolean,
    @Query() query?: string,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgInterfaceDto>> {
    return this._service.list(
      getContextUser(req),
      { nodeId, hostNodeId, endpointId, viaRelay, enabled, query },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список интерфейсов для выпадающих списков (в рамках прав).
   * @summary Интерфейсы (options)
   */
  @Security("jwt", ["permission:wg:interface:view:own"])
  @Get("options")
  wgInterfaceOptions(
    @Request() req: KoaRequest,
    @Query() nodeId?: UUID,
  ): Promise<WgInterfaceOptionDto[]> {
    return this._service.options(getContextUser(req), nodeId);
  }

  /**
   * Интерфейс по id; чужой без права на все интерфейсы — 404.
   * @summary Интерфейс
   */
  @Security("jwt", ["permission:wg:interface:view:own"])
  @Get("{id}")
  getWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgInterfaceDto> {
    return this._service.get(getContextUser(req), id);
  }

  /**
   * Изменить интерфейс: переданные поля заменяются; агент применяет
   * конфигурацию автоматически.
   * @summary Изменение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:update:own"])
  @ValidateBody(UpdateWgInterfaceSchema)
  @Patch("{id}")
  updateWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    return this._service.update(getContextUser(req), id, body);
  }

  /**
   * Удалить интерфейс; с пирами — 409.
   * @summary Удаление интерфейса
   */
  @Security("jwt", ["permission:wg:interface:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._service.delete(getContextUser(req), id);
  }

  /**
   * Включить интерфейс (агент поднимет его).
   * @summary Включение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control:own"])
  @Post("{id}/enable")
  enableWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgInterfaceDto> {
    return this._service.setEnabled(getContextUser(req), id, true);
  }

  /**
   * Выключить интерфейс (агент опустит его, пиры отключатся).
   * @summary Выключение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control:own"])
  @Post("{id}/disable")
  disableWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgInterfaceDto> {
    return this._service.setEnabled(getContextUser(req), id, false);
  }

  /**
   * Перенести интерфейс с ключом и пирами на другую ноду (видимую автору).
   * С точкой подключения клиентские конфиги не меняются; без неё меняется
   * адрес подключения (publicHost новой ноды).
   * @summary Перенос интерфейса на другую ноду
   */
  @Security("jwt", ["permission:wg:interface:move:own"])
  @ValidateBody(MoveWgInterfaceSchema)
  @Post("{id}/move")
  moveWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IMoveWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    return this._service.move(getContextUser(req), id, body.nodeId);
  }

  /**
   * Скопировать интерфейс на ноду (видимую автору): тот же ключ, адреса и
   * всегда те же пиры. Релей точки подключения держит туннели до всех копий
   * и переключает трафик (авто по здоровью или закреплённая копия —
   * `activeReplicaNodeId`).
   * @summary Реплика интерфейса на ноде
   */
  @Security("jwt", ["permission:wg:interface:replicas:own"])
  @ValidateBody(AddWgInterfaceReplicaSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/replicas")
  addWgInterfaceReplica(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAddWgInterfaceReplicaBody,
  ): Promise<WgInterfaceDto> {
    return this._replicas.addReplica(getContextUser(req), id, body.nodeId);
  }

  /**
   * Убрать реплику: агент ноды снимет интерфейс.
   * @summary Удаление реплики интерфейса
   */
  @Security("jwt", ["permission:wg:interface:replicas:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}/replicas/{nodeId}")
  async removeWgInterfaceReplica(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() nodeId: UUID,
  ): Promise<void> {
    await this._replicas.removeReplica(getContextUser(req), id, nodeId);
  }

  /**
   * Перезапустить интерфейс на ноде (`wg-quick down && up`).
   * @summary Перезапуск интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control:own"])
  @SuccessResponse(201, "Created")
  @Post("{id}/restart")
  restartWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgNodeCommandDto> {
    return this._service.restart(getContextUser(req), id);
  }

  /**
   * Назначить владельца интерфейса (он станет для него своим).
   * @summary Назначение владельца интерфейса
   */
  @Security("jwt", ["permission:wg:interface:assign:own"])
  @ValidateBody(AssignWgInterfaceSchema)
  @Post("{id}/assign")
  assignWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    return this._service.assign(getContextUser(req), id, body);
  }

  /**
   * Снять владельца интерфейса.
   * @summary Снятие владельца интерфейса
   */
  @Security("jwt", ["permission:wg:interface:assign:own"])
  @Post("{id}/revoke")
  revokeWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgInterfaceDto> {
    return this._service.revoke(getContextUser(req), id);
  }
}
