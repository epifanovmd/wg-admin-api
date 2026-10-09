import { inject } from "inversify";
import {
  Body,
  Controller,
  Get,
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
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyDto, ICreateApiKeyBody, ICreatedApiKeyDto } from "./dto";
import { CreateApiKeySchema, ListApiKeysQuerySchema } from "./validation";

@Injectable()
@Tags("ApiKey")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/api-keys")
export class ApiKeyController extends Controller {
  constructor(@inject(ApiKeyService) private readonly _keys: ApiKeyService) {
    super();
  }

  /**
   * Создать API-ключ сервиса. Полный ключ (`key`) возвращается только в
   * этом ответе — сохраните его: в БД хранится лишь хеш.
   * @summary Создание API-ключа
   */
  @Security("jwt", ["permission:apikey:create"])
  @ValidateBody(CreateApiKeySchema)
  @SuccessResponse(201, "Created")
  @Post()
  async createApiKey(
    @Request() req: KoaRequest,
    @Body() body: ICreateApiKeyBody,
  ): Promise<ICreatedApiKeyDto> {
    const created = await this._keys.create(getContextUser(req).userId, body);

    this.setStatus(201);

    return created;
  }

  /**
   * Все API-ключи, новые первыми. Секреты не возвращаются.
   * @summary Список API-ключей
   */
  @Security("jwt", ["permission:apikey:view"])
  @ValidateQuery(ListApiKeysQuerySchema)
  @Get()
  listApiKeys(
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<ApiKeyDto>> {
    return this._keys.list(offset, limit);
  }

  /**
   * Отозвать ключ: запросы с ним сразу получают 401. Повторный отзыв — 204.
   * @summary Отзыв API-ключа
   */
  @Security("jwt", ["permission:apikey:revoke"])
  @SuccessResponse(204, "No Content")
  @Post("{id}/revoke")
  async revokeApiKey(
    @Path() id: UUID,
    @Request() req: KoaRequest,
  ): Promise<void> {
    await this._keys.revoke(id, getContextUser(req).userId);
    this.setStatus(204);
  }
}
