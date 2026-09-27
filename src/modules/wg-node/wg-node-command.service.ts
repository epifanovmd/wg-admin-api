import { inject } from "inversify";

import { Injectable } from "../../core";
import type { IWgNodeLogsDto } from "./dto";
import { WgNodeCommandDto } from "./dto";
import { wgConfig } from "./wg.config";
import { WgNode } from "./wg-node.entity";
import { WgNodeError } from "./wg-node.errors";
import { WgNodeRepository } from "./wg-node.repository";
import {
  EWgNodeCommandStatus,
  EWgNodeCommandType,
  EWgNodeStatus,
  IWgNodeCommandPayload,
  WG_AGENT_LOGS_DEFAULT_LINES,
} from "./wg-node.types";
import { WgNodeCommand } from "./wg-node-command.entity";
import { WgNodeCommandRepository } from "./wg-node-command.repository";

const WAIT_POLL_MS = 300;
const TRUNCATED_MARKER = "\n…[вывод обрезан]";

/** Скачать бинарь агента — с запасом на медленный канал. */
const AGENT_UPDATE_TIMEOUT_SEC = 300;

/** Команды агенту (перезапуск интерфейса, журнал, обновление): создание, вывод, итог, таймауты. */
@Injectable()
export class WgNodeCommandService {
  constructor(
    @inject(WgNodeCommandRepository)
    private readonly _commands: WgNodeCommandRepository,
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
  ) {}

  /** Перезапуск интерфейса `wg-quick down && up` на ноде. */
  async createInterfaceRestart(
    nodeId: string,
    actorId: string,
    interfaceName: string,
  ): Promise<WgNodeCommandDto> {
    return this._create(
      nodeId,
      actorId,
      EWgNodeCommandType.InterfaceRestart,
      wgConfig.commandTimeoutSec,
      { interfaceName },
    );
  }

  /** Обновление агента: бинарь с бэкенда (сверка sha256), затем перезапуск. */
  createAgentUpdate(
    nodeId: string,
    actorId: string,
    hash: string,
  ): Promise<WgNodeCommandDto> {
    return this._create(
      nodeId,
      actorId,
      EWgNodeCommandType.AgentUpdate,
      AGENT_UPDATE_TIMEOUT_SEC,
      { hash },
    );
  }

  /** Журнал агента: команда + синхронное ожидание результата. */
  async requestAgentLogs(
    nodeId: string,
    actorId: string,
    lines?: number,
  ): Promise<IWgNodeLogsDto> {
    const command = await this._create(
      nodeId,
      actorId,
      EWgNodeCommandType.AgentLogs,
      wgConfig.commandTimeoutSec,
      { lines: lines ?? WG_AGENT_LOGS_DEFAULT_LINES },
    );
    const finished = await this._waitForCompletion(
      command.id,
      wgConfig.commandTimeoutSec * 1000,
    );

    return { content: finished.output };
  }

  /** Невыполненные команды ноды — для выдачи агенту. */
  async pendingForAgent(nodeId: string): Promise<WgNodeCommand[]> {
    return this._commands.findPendingByNode(nodeId);
  }

  /** Агент взял команду в работу. */
  async ack(node: WgNode, commandId: string): Promise<void> {
    await this._findAgentCommand(node, commandId);
    await this._commands.transitionStatus(
      commandId,
      [EWgNodeCommandStatus.Pending],
      { status: EWgNodeCommandStatus.Running, startedAt: new Date() },
    );
  }

  /** Очередной фрагмент вывода команды от агента. */
  async appendOutput(
    node: WgNode,
    commandId: string,
    chunk: string,
  ): Promise<void> {
    const command = await this._findAgentCommand(node, commandId);

    if (
      command.status !== EWgNodeCommandStatus.Running &&
      command.status !== EWgNodeCommandStatus.Pending
    ) {
      throw WgNodeError.COMMAND_NOT_PENDING();
    }

    if (command.output.length < wgConfig.commandOutputMaxBytes) {
      const next = command.output + chunk;

      command.output =
        next.length > wgConfig.commandOutputMaxBytes
          ? next.slice(0, wgConfig.commandOutputMaxBytes) + TRUNCATED_MARKER
          : next;
      await this._commands.update(
        { id: command.id },
        { output: command.output },
      );
    }
  }

  /** Итог команды от агента. */
  async complete(
    node: WgNode,
    commandId: string,
    result: { exitCode?: number | null; error?: string | null },
  ): Promise<void> {
    const failed = result.error != null || (result.exitCode ?? 0) !== 0;
    const moved = await this._commands.transitionStatus(
      commandId,
      [EWgNodeCommandStatus.Pending, EWgNodeCommandStatus.Running],
      {
        status: failed
          ? EWgNodeCommandStatus.Failed
          : EWgNodeCommandStatus.Succeeded,
        exitCode: result.exitCode ?? null,
        error: result.error ?? null,
        finishedAt: new Date(),
      },
    );

    if (!moved) throw WgNodeError.COMMAND_NOT_PENDING();
  }

  /** Просроченные команды — в timeout; возвращает число закрытых. */
  async sweepExpired(): Promise<number> {
    const expired = await this._commands.findExpired(15);
    let closed = 0;

    for (const command of expired) {
      const moved = await this._commands.transitionStatus(
        command.id,
        [EWgNodeCommandStatus.Pending, EWgNodeCommandStatus.Running],
        { status: EWgNodeCommandStatus.Timeout, finishedAt: new Date() },
      );

      if (moved) closed += 1;
    }

    return closed;
  }

  purgeFinished(): Promise<number> {
    const cutoff = new Date(
      Date.now() - wgConfig.commandRetentionDays * 24 * 3600 * 1000,
    );

    return this._commands.deleteFinishedBefore(cutoff);
  }

  private async _create(
    nodeId: string,
    actorId: string,
    type: EWgNodeCommandType,
    timeoutSec: number,
    payload: IWgNodeCommandPayload,
  ): Promise<WgNodeCommandDto> {
    const node = await this._nodes.findOne({ where: { id: nodeId } });

    if (!node) throw WgNodeError.NOT_FOUND();
    if (node.status !== EWgNodeStatus.Online) throw WgNodeError.AGENT_OFFLINE();

    const command = await this._commands.createAndSave({
      nodeId,
      type,
      status: EWgNodeCommandStatus.Pending,
      payload,
      output: "",
      requestedBy: actorId,
      timeoutSec,
    });

    return WgNodeCommandDto.fromEntity(command);
  }

  private async _findAgentCommand(
    node: WgNode,
    commandId: string,
  ): Promise<WgNodeCommand> {
    const command = await this._commands.findOne({
      where: { id: commandId, nodeId: node.id },
    });

    if (!command) throw WgNodeError.COMMAND_NOT_FOUND();

    return command;
  }

  private async _waitForCompletion(
    commandId: string,
    timeoutMs: number,
  ): Promise<WgNodeCommand> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const command = await this._commands.findOne({
        where: { id: commandId },
      });

      if (!command) throw WgNodeError.COMMAND_NOT_FOUND();
      if (
        command.status !== EWgNodeCommandStatus.Pending &&
        command.status !== EWgNodeCommandStatus.Running
      ) {
        return command;
      }
      if (Date.now() >= deadline) throw WgNodeError.COMMAND_WAIT_TIMEOUT();

      await new Promise(resolve => setTimeout(resolve, WAIT_POLL_MS));
    }
  }
}
