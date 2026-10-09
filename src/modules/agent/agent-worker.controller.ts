import { inject } from "inversify";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Produces,
  Put,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import {
  getContextUser,
  Injectable,
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { KoaRequest } from "../../types/koa";
import { withRetryAfter } from "./agent.errors";
import { AGENT_WORKER_STATUS_HEADER } from "./agent.types";
import { AgentWorkerService } from "./agent-worker.service";
import {
  IAgentConfigEntryDto,
  IAgentFetchBody,
  IAgentWorkerActionBody,
  IAgentWorkerActionResultDto,
  ISetAgentConfigBody,
  TAgentId,
  TAgentWorkerName,
} from "./dto";
import {
  AgentConfigsQuerySchema,
  AgentFetchSchema,
  AgentWorkerActionSchema,
  SetAgentConfigSchema,
} from "./validation";

/** Прервать запрос к воркеру, если клиент ушёл, не дочитав ответ. */
const abortOnClose = (req: KoaRequest): AbortSignal => {
  const abort = new AbortController();
  const res = req.ctx.res;

  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  return abort.signal;
};

/**
 * Воркеры агента: перезапуск и обновление, настройки по ключам, запрос к
 * воркеру. Доступ — право модуля или политика (агент своего узла); проверяет
 * сервис. Действия и запросы выполняет копия с соединением агента (из другой
 * копии вызов пересылается); без пересылки между копиями — 503
 * `AGENT_ELSEWHERE` с `Retry-After`.
 */
@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agents")
export class AgentWorkerController extends Controller {
  constructor(
    @inject(AgentWorkerService) private readonly _workers: AgentWorkerService,
  ) {
    super();
  }

  /**
   * Перезапустить воркер. Свободный — перезапускается сразу (`deferred:
   * false` после запуска). Занятый (`health.busy`) — ответ сразу (`deferred:
   * true`, `pending`, `actionId`), замена — после окончания работы, её итог —
   * событие сокета `agent:action` (`id = actionId`, `deferred: true`);
   * `force` — заменить сразу.
   * @summary Перезапуск воркера
   */
  @Security("jwt")
  @ValidateBody(AgentWorkerActionSchema)
  @Post("{id}/workers/{worker}/restart")
  restartAgentWorker(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IAgentWorkerActionBody,
  ): Promise<IAgentWorkerActionResultDto> {
    return withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () =>
        this._workers.restart(getContextUser(req), id, worker, !!body.force),
    );
  }

  /**
   * Обновить воркер (`release: true`) до новейшей сборки под агента. Свободный — сразу
   * (версии в ответе); занятый — как у перезапуска: ответ `deferred: true`,
   * итог — событие `agent:action`; `force` — сразу. Новая сборка не
   * заработала — агент возвращает прежнюю.
   * @summary Обновление воркера
   */
  @Security("jwt")
  @ValidateBody(AgentWorkerActionSchema)
  @Post("{id}/workers/{worker}/update")
  updateAgentWorker(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IAgentWorkerActionBody,
  ): Promise<IAgentWorkerActionResultDto> {
    return withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () => this._workers.update(getContextUser(req), id, worker, !!body.force),
    );
  }

  /**
   * Запрос к воркеру через агента: метод, путь, заголовки, тело. Ответ —
   * статус, заголовки и тело воркера потоком и заголовок
   * `X-Agent-Worker-Status` (статус ответа воркера): по нему ответ воркера
   * отличается от ошибки API (её тело — `{ code, message }`, заголовка нет).
   * Служебные пути воркера (`/health`, `/metrics`, `/config/*`, `/cleanup`)
   * недоступны. В аудит попадают изменяющие запросы (`POST`, `PUT`, `PATCH`,
   * `DELETE`).
   * @summary Запрос к воркеру
   */
  @Security("jwt")
  @ValidateBody(AgentFetchSchema)
  @Produces("application/octet-stream")
  @Post("{id}/workers/{worker}/fetch")
  async fetchAgentWorker(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IAgentFetchBody,
  ): Promise<Readable> {
    const result = await withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () =>
        this._workers.fetch(
          getContextUser(req),
          id,
          worker,
          body,
          abortOnClose(req),
        ),
    );

    this.setStatus(result.status);
    for (const [name, value] of Object.entries(result.headers)) {
      this.setHeader(name, value);
    }
    this.setHeader(AGENT_WORKER_STATUS_HEADER, String(result.status));

    return result.body
      ? Readable.fromWeb(result.body as WebReadableStream<Uint8Array>)
      : Readable.from([]);
  }

  /**
   * Ключи настроек агента (или одного воркера): значение и статус
   * применения — желаемая, доставленная и применённая версии, ошибка.
   * @summary Настройки воркеров агента
   */
  @Security("jwt")
  @ValidateQuery(AgentConfigsQuerySchema)
  @Get("{id}/configs")
  getAgentConfigs(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Query() worker?: TAgentWorkerName,
  ): Promise<IAgentConfigEntryDto[]> {
    return this._workers.listConfigs(getContextUser(req), id, worker);
  }

  /**
   * Ключ настроек воркера: значение и статус применения.
   * @summary Настройка воркера
   */
  @Security("jwt")
  @Get("{id}/workers/{worker}/configs/{key}")
  getAgentWorkerConfig(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Path() key: TAgentWorkerName,
  ): Promise<IAgentConfigEntryDto> {
    return this._workers.getConfig(getContextUser(req), id, worker, key);
  }

  /**
   * Записать значение ключа (новая версия). Значение проверяется по схеме
   * ключа из манифеста воркера (400 `AGENT_CONFIG_INVALID`); агент получит
   * его сразу или при подключении, итог — в статусе и событии сокета.
   * @summary Запись настройки воркера
   */
  @Security("jwt")
  @ValidateBody(SetAgentConfigSchema)
  @Put("{id}/workers/{worker}/configs/{key}")
  setAgentWorkerConfig(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Path() key: TAgentWorkerName,
    @Body() body: ISetAgentConfigBody,
  ): Promise<IAgentConfigEntryDto> {
    return this._workers.setConfig(
      getContextUser(req),
      id,
      worker,
      key,
      body.data,
    );
  }

  /**
   * Удалить ключ: агент удалит его у себя и у воркера. Ключа нет — 404.
   * @summary Удаление настройки воркера
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Delete("{id}/workers/{worker}/configs/{key}")
  async deleteAgentWorkerConfig(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Path() key: TAgentWorkerName,
  ): Promise<void> {
    await this._workers.deleteConfig(getContextUser(req), id, worker, key);
    this.setStatus(204);
  }
}
