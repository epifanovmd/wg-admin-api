import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Path,
  Post,
  Put,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { KoaRequest } from "../../types/koa";
import { AgentService } from "./agent.service";
import {
  AgentCommandDto,
  AgentConfigDto,
  TAgentId,
  TAgentWorkerName,
} from "./dto";
import {
  WorkerCommandBodySchema,
  WorkerRestartBodySchema,
  WorkerUpdateBodySchema,
} from "./validation";

interface IWorkerRestartBody {
  /** Не ждать, пока воркер занят. */
  force?: boolean;
}

interface IWorkerUpdateBody {
  /** Версия из каталога сборок; без неё — старшая для платформы узла. */
  version?: string;
  force?: boolean;
}

interface IWorkerCommandBody {
  /** Тип команды из манифеста воркера. */
  type: string;
  args?: any;
  /** Срок ответа воркера, мс; без него — без срока. */
  timeoutMs?: number;
  /** Подождать итог, с (0 — сразу вернуть поставленную команду). */
  waitSeconds?: number;
}

/** Воркеры агента: перезапуск, обновление, команды, настройки. */
@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agents/{id}/workers/{worker}")
export class AgentWorkerController extends Controller {
  constructor(@inject(AgentService) private readonly _agents: AgentService) {
    super();
  }

  /**
   * Перезапустить воркер; занятый — после окончания работы (или сразу с `force`).
   * @summary Перезапустить воркер
   */
  @Security("jwt")
  @ValidateBody(WorkerRestartBodySchema)
  @Post("restart")
  restartAgentWorker(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IWorkerRestartBody,
  ): Promise<AgentCommandDto> {
    return this._agents.restartWorker(
      getContextUser(req),
      id,
      worker,
      body.force,
    );
  }

  /**
   * Обновить воркер сборкой из каталога сборок проекта (подпись проверяет агент); новая не
   * заработала — агент возвращает прежнюю.
   * @summary Обновить воркер
   */
  @Security("jwt")
  @ValidateBody(WorkerUpdateBodySchema)
  @Post("update")
  updateAgentWorker(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IWorkerUpdateBody,
  ): Promise<AgentCommandDto> {
    return this._agents.updateWorker(
      getContextUser(req),
      id,
      worker,
      body.version,
      body.force,
    );
  }

  /**
   * Команда воркеру (тип — из `manifest.commands`); итог — в ответе (`waitSeconds`), по
   * `GET /agents/{id}/commands/{commandId}` и сокету.
   * @summary Команда воркеру
   */
  @Security("jwt")
  @ValidateBody(WorkerCommandBodySchema)
  @Post("commands")
  sendAgentWorkerCommand(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Body() body: IWorkerCommandBody,
  ): Promise<AgentCommandDto> {
    return this._agents.workerCommand(getContextUser(req), id, worker, body);
  }

  /**
   * Записать ключ настроек воркера (тело — значение): новая версия желаемого.
   * @summary Записать настройку воркера
   */
  @Security("jwt")
  @Put("configs/{key}")
  setAgentWorkerConfig(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Path() key: TAgentWorkerName,
    @Body() data: any,
  ): Promise<AgentConfigDto> {
    return this._agents.setConfig(getContextUser(req), id, worker, key, data);
  }

  /** @summary Удалить настройку воркера */
  @Security("jwt")
  @SuccessResponse(204)
  @Delete("configs/{key}")
  async deleteAgentWorkerConfig(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() worker: TAgentWorkerName,
    @Path() key: TAgentWorkerName,
  ): Promise<void> {
    await this._agents.deleteConfig(getContextUser(req), id, worker, key);
    this.setStatus(204);
  }
}
