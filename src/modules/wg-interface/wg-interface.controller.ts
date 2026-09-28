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
  ICreateWgInterfaceBody,
  IMoveWgInterfaceBody,
  IUpdateWgInterfaceBody,
  WgInterfaceDto,
  WgInterfaceOptionDto,
} from "./dto";
import {
  AddWgInterfaceReplicaSchema,
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
   * приватный ключ хранится зашифрованным. Произвольные PostUp/PostDown —
   * только суперпользователь.
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
   * Интерфейсы с фильтрами (с копиями), новые первыми. `viaRelay` — только
   * интерфейсы за точками через релей: что и куда пересылают релеи.
   * @summary Список интерфейсов
   */
  @Security("jwt", ["permission:wg:interface:view"])
  @Get()
  listWgInterfaces(
    @Query() nodeId?: UUID,
    @Query() endpointId?: UUID,
    @Query() viaRelay?: boolean,
    @Query() enabled?: boolean,
    @Query() query?: string,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgInterfaceDto>> {
    return this._service.list(
      { nodeId, endpointId, viaRelay, enabled, query },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список интерфейсов для выпадающих списков.
   * @summary Интерфейсы (options)
   */
  @Security("jwt", ["permission:wg:interface:view"])
  @Get("options")
  wgInterfaceOptions(@Query() nodeId?: UUID): Promise<WgInterfaceOptionDto[]> {
    return this._service.options(nodeId);
  }

  /**
   * Интерфейс по id.
   * @summary Интерфейс
   */
  @Security("jwt", ["permission:wg:interface:view"])
  @Get("{id}")
  getWgInterface(@Path() id: UUID): Promise<WgInterfaceDto> {
    return this._service.get(id);
  }

  /**
   * Изменить интерфейс: переданные поля заменяются; агент применяет
   * конфигурацию автоматически.
   * @summary Изменение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:update"])
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
  @Security("jwt", ["permission:wg:interface:delete"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgInterface(@Path() id: UUID): Promise<void> {
    await this._service.delete(id);
  }

  /**
   * Включить интерфейс (агент поднимет его).
   * @summary Включение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control"])
  @Post("{id}/enable")
  enableWgInterface(@Path() id: UUID): Promise<WgInterfaceDto> {
    return this._service.setEnabled(id, true);
  }

  /**
   * Выключить интерфейс (агент опустит его, пиры отключатся).
   * @summary Выключение интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control"])
  @Post("{id}/disable")
  disableWgInterface(@Path() id: UUID): Promise<WgInterfaceDto> {
    return this._service.setEnabled(id, false);
  }

  /**
   * Перенести интерфейс с ключом и пирами на другую ноду. С точкой
   * подключения клиентские конфиги не меняются; без неё меняется адрес
   * подключения (publicHost новой ноды).
   * @summary Перенос интерфейса на другую ноду
   */
  @Security("jwt", ["permission:wg:interface:move"])
  @ValidateBody(MoveWgInterfaceSchema)
  @Post("{id}/move")
  moveWgInterface(
    @Path() id: UUID,
    @Body() body: IMoveWgInterfaceBody,
  ): Promise<WgInterfaceDto> {
    return this._service.move(id, body.nodeId);
  }

  /**
   * Скопировать интерфейс на ноду: тот же ключ, адреса и всегда те же пиры.
   * Релей точки подключения держит туннели до всех копий и переключает
   * трафик (авто по здоровью или закреплённая копия — `activeReplicaNodeId`).
   * @summary Реплика интерфейса на ноде
   */
  @Security("jwt", ["permission:wg:interface:replicas"])
  @ValidateBody(AddWgInterfaceReplicaSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/replicas")
  addWgInterfaceReplica(
    @Path() id: UUID,
    @Body() body: IAddWgInterfaceReplicaBody,
  ): Promise<WgInterfaceDto> {
    return this._replicas.addReplica(id, body.nodeId);
  }

  /**
   * Убрать реплику: агент ноды снимет интерфейс.
   * @summary Удаление реплики интерфейса
   */
  @Security("jwt", ["permission:wg:interface:replicas"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}/replicas/{nodeId}")
  async removeWgInterfaceReplica(
    @Path() id: UUID,
    @Path() nodeId: UUID,
  ): Promise<void> {
    await this._replicas.removeReplica(id, nodeId);
  }

  /**
   * Перезапустить интерфейс на ноде (`wg-quick down && up`).
   * @summary Перезапуск интерфейса
   */
  @Security("jwt", ["permission:wg:interface:control"])
  @SuccessResponse(201, "Created")
  @Post("{id}/restart")
  restartWgInterface(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgNodeCommandDto> {
    return this._service.restart(getContextUser(req).userId, id);
  }
}
