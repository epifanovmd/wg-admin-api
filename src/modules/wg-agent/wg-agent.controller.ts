import type { Readable } from "node:stream";

import { inject } from "inversify";
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Produces,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import { config } from "../../config";
import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { WgNode, WgNodeCommandService, WgNodeService } from "../wg-node";
import { renderInstallScript } from "../wg-provision";
import { EWgAgentTransport } from "../wg-stats";
import {
  WgAgentCommandCompleteSchema,
  WgAgentCommandOutputSchema,
  WgAgentReportSchema,
  WgAgentStatsSchema,
} from "./validation";
import { WgAgentError } from "./wg-agent.errors";
import { WgAgentBinaryService } from "./wg-agent-binary.service";
import {
  IWgAgentCommandCompleteBody,
  IWgAgentCommandOutputBody,
  IWgAgentDesiredState,
  IWgAgentReportBody,
  IWgAgentStatsBody,
} from "./wg-agent-protocol";
import { WgAgentSessionService } from "./wg-agent-session.service";
import { WgAgentStateService } from "./wg-agent-state.service";

/**
 * Протокол агента ноды. Аутентификация — api-ключ со scope
 * `wg-agent:<nodeId>`; каждый вызов подтверждает живость агента.
 */
@Injectable()
@Tags("WgAgent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg-agent")
export class WgAgentController extends Controller {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgAgentStateService)
    private readonly _state: WgAgentStateService,
    @inject(WgAgentSessionService)
    private readonly _session: WgAgentSessionService,
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
    @inject(WgAgentBinaryService)
    private readonly _binaries: WgAgentBinaryService,
  ) {
    super();
  }

  /**
   * Желаемое состояние ноды (long-poll): ответ приходит при изменении
   * конфигурации, появлении команд или по таймауту ожидания.
   * @summary Desired state (long-poll)
   */
  @Security("apiKey", ["wg-agent"])
  @Get("state")
  async wgAgentState(
    @Request() req: KoaRequest,
    @Query() knownVersion?: number,
    @Query() waitMs?: number,
  ): Promise<IWgAgentDesiredState> {
    const node = await this._node(req);

    await this._nodes.touchAgent(node, req.ip);

    return this._state.waitAndBuild(node, knownVersion ?? -1, waitMs ?? 0);
  }

  /**
   * Отчёт агента: применённая версия, ошибка применения, версии ПО,
   * сведения об ОС и фактические статусы интерфейсов.
   * @summary Отчёт о состоянии
   */
  @Security("apiKey", ["wg-agent"])
  @ValidateBody(WgAgentReportSchema)
  @SuccessResponse(204, "No Content")
  @Post("state")
  async wgAgentReport(
    @Request() req: KoaRequest,
    @Body() body: IWgAgentReportBody,
  ): Promise<void> {
    const node = await this._node(req);

    await this._nodes.touchAgent(node, req.ip);
    await this._session.report(node, body);
  }

  /**
   * Статистика `wg show all dump` и системные метрики хоста.
   * @summary Статистика
   */
  @Security("apiKey", ["wg-agent"])
  @ValidateBody(WgAgentStatsSchema)
  @SuccessResponse(204, "No Content")
  @Post("stats")
  async wgAgentStats(
    @Request() req: KoaRequest,
    @Body() body: IWgAgentStatsBody,
  ): Promise<void> {
    const node = await this._node(req);

    await this._nodes.touchAgent(node);
    await this._session.stats(node, body, EWgAgentTransport.Http);
  }

  /**
   * Агент взял команду в работу.
   * @summary Команда: взята
   */
  @Security("apiKey", ["wg-agent"])
  @SuccessResponse(204, "No Content")
  @Post("commands/{id}/ack")
  async wgAgentCommandAck(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._commands.ack(await this._node(req), id);
  }

  /**
   * Фрагмент вывода команды: дописывается в `output` команды (с пределом).
   * @summary Команда: вывод
   */
  @Security("apiKey", ["wg-agent"])
  @ValidateBody(WgAgentCommandOutputSchema)
  @SuccessResponse(204, "No Content")
  @Post("commands/{id}/output")
  async wgAgentCommandOutput(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IWgAgentCommandOutputBody,
  ): Promise<void> {
    await this._commands.appendOutput(await this._node(req), id, body.chunk);
  }

  /**
   * Итог выполнения команды.
   * @summary Команда: завершена
   */
  @Security("apiKey", ["wg-agent"])
  @ValidateBody(WgAgentCommandCompleteSchema)
  @SuccessResponse(204, "No Content")
  @Post("commands/{id}/complete")
  async wgAgentCommandComplete(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IWgAgentCommandCompleteBody,
  ): Promise<void> {
    await this._commands.complete(await this._node(req), id, body);
  }

  /**
   * Бинарь агента своей архитектуры (установка и команда `agent-update`):
   * sha256 — в заголовке `X-Agent-Sha256`, агент и установщик его сверяют.
   * @summary Бинарь агента
   */
  @Security("apiKey", ["wg-agent"])
  @Produces("application/octet-stream")
  @Get("binary/{arch}")
  async wgAgentBinary(
    @Request() req: KoaRequest,
    @Path() arch: string,
  ): Promise<Readable> {
    await this._node(req);

    const binary = await this._binaries.binary(arch);

    if (!binary) throw WgAgentError.BINARY_NOT_BUILT();

    this.setHeader("Content-Type", "application/octet-stream");
    this.setHeader("Content-Length", String(binary.size));
    this.setHeader("X-Agent-Sha256", binary.hash);
    this.setHeader(
      "Content-Disposition",
      `attachment; filename="wg-admin-agent-linux-${binary.arch}"`,
    );

    return this._binaries.open(binary);
  }

  /**
   * Установщик агента (sh) для ручной установки на сервер:
   * `curl -fsSL <бэкенд>/api/v1/wg-agent/install.sh | sudo sh -s -- --key <ключ>`.
   * Секретов не содержит — бинарь скачивается по ключу агента.
   * @summary Установщик агента
   */
  @Produces("text/plain")
  @Get("install.sh")
  wgAgentInstallScript(@Request() req: KoaRequest): string {
    this.setHeader("Content-Type", "text/plain; charset=utf-8");

    return renderInstallScript(config.app.publicUrl ?? req.origin);
  }

  private _node(req: KoaRequest): Promise<WgNode> {
    return this._nodes.findByAgentScopes(getContextUser(req).permissions);
  }
}
