import { inject } from "inversify";

import {
  AgentEnrollmentService,
  AgentError,
  Agents,
  IAgentEnrollmentSource,
  Injectable,
  logger,
} from "../../core";
import type { AuthContext } from "../../types/koa";
import { AgentDto, AgentService } from "../agent";
import type {
  ICreateWgNodeInstallCommandBody,
  IWgNodeInstallCommandDto,
} from "./dto";
import { WgNode } from "./wg-node.entity";
import { WgNodeError } from "./wg-node.errors";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeService } from "./wg-node.service";
import {
  WG_AGENT_INSTANCE,
  WG_INTERFACE_RESTART_COMMAND,
  WG_NODE_ID_LABEL,
  WG_NODE_INSTALL_TOKEN_TTL_MINUTES,
  WG_WORKER,
} from "./wg-node.types";
import { wgNodeStateOf } from "./wg-node-status";

const MINUTE_MS = 60_000;

/** Срок перезапуска интерфейса: wg-quick down/up на воркере. */
const RESTART_TIMEOUT_MS = 90_000;

/** Сколько ждать итог перезапуска (команда доходит до агента и воркера). */
const RESTART_WAIT_MS = RESTART_TIMEOUT_MS + 10_000;

/** Выпущенный для ноды токен регистрации. */
export interface IWgNodeEnrollmentToken {
  tokenId: string;
  token: string;
  expiresAt: Date;
}

/** Итог перезапуска интерфейса воркером wg. */
export interface IWgInterfaceRestartResult {
  name: string;
  status: string;
}

/**
 * Агент ноды: токен регистрации с меткой ноды и команда установки, привязка
 * агента после регистрации, состояние ноды по агенту, команды воркеру wg
 * (перезапуск интерфейса), отвязка при отзыве и удалении. Действия с самим
 * агентом (журнал, обновления, перезапуск воркеров) — маршруты агентов: к
 * агенту ноды открывают доступ права ноды (`WgNodeAgentAccessPolicy`).
 */
@Injectable()
export class WgNodeAgentService {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(AgentService) private readonly _agents: AgentService,
    @inject(Agents) private readonly _core: Agents,
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
  ) {}

  /**
   * Команда установки агента вручную: одноразовый токен с меткой ноды (агент
   * привяжется к ней при регистрации) и строка `curl … | sudo sh`.
   */
  async installCommand(
    actor: AuthContext,
    id: string,
    body: ICreateWgNodeInstallCommandBody = {},
  ): Promise<IWgNodeInstallCommandDto> {
    const node = await this._nodes.findFor(
      actor,
      id,
      WgNodePermissions.NODE_AGENT,
    );

    return this.installFor(
      actor.userId,
      node,
      body.expiresInMinutes ?? WG_NODE_INSTALL_TOKEN_TTL_MINUTES,
    );
  }

  /** Токен и команда установки для ноды (без проверки прав). */
  async installFor(
    actorId: string,
    node: WgNode,
    ttlMinutes = WG_NODE_INSTALL_TOKEN_TTL_MINUTES,
  ): Promise<IWgNodeInstallCommandDto> {
    const issued = await this.issueToken(actorId, node, ttlMinutes);

    return {
      command: this.commandFor(node, { token: issued.token }),
      ...issued,
    };
  }

  /** Одноразовый токен регистрации с меткой ноды. */
  async issueToken(
    actorId: string,
    node: Pick<WgNode, "id" | "name">,
    ttlMinutes: number,
  ): Promise<IWgNodeEnrollmentToken> {
    const expiresAt = new Date(Date.now() + ttlMinutes * MINUTE_MS);
    const created = await this._enrollment.createToken(actorId, {
      name: `wg-node:${node.name}`.slice(0, 100),
      labels: { [WG_NODE_ID_LABEL]: node.id },
      maxUses: 1,
      expiresAt,
    });

    return {
      tokenId: created.enrollmentToken.id,
      token: created.token,
      expiresAt,
    };
  }

  /** Отозвать токен (установка не удалась); ошибки — в журнал. */
  async revokeToken(tokenId: string): Promise<void> {
    await this._enrollment
      .revokeToken(tokenId)
      .catch(err =>
        logger.warn({ err, tokenId }, "[WG] Токен установки не отозван"),
      );
  }

  /**
   * Команда установки агента ноды: архив папки агента с этого сервера — экземпляр
   * `wg`, воркеры wg и socks, права root, пакеты и параметры ядра для WireGuard,
   * пробросов и NAT задаёт `agent/agent.prod.yaml`; здесь — токен и имя ноды.
   */
  commandFor(
    node: Pick<WgNode, "name">,
    auth: { token: string } | { tokenFile: string },
    baseUrl?: string,
  ): string {
    return this._agents.installCommand({
      ...auth,
      ...(baseUrl && { server: baseUrl }),
      name: node.name,
    });
  }

  /** Экземпляр агента проекта на ноде (`instance` в agent/agent.prod.yaml). */
  instance(): string {
    return WG_AGENT_INSTANCE;
  }

  /** Адрес бэкенда для агентов. */
  publicUrl(): string {
    return this._agents.publicUrl();
  }

  /**
   * Привязать к ноде зарегистрированного агента вручную (общий токен
   * окружения, переустановка): агент не должен принадлежать другой ноде.
   */
  async bind(
    actor: AuthContext,
    nodeId: string,
    agentId: string,
  ): Promise<void> {
    const node = await this._nodes.findFor(
      actor,
      nodeId,
      WgNodePermissions.NODE_AGENT,
    );
    const agent = await this._agents.find(agentId);

    if (!agent || agent.revoked) throw WgNodeError.AGENT_NOT_FOUND();

    const owner = await this._nodes.findByAgentId(agentId);

    if (owner && owner.id !== node.id) throw WgNodeError.AGENT_BOUND();

    await this._attach(node.id, agent, actor.userId);
  }

  /**
   * Агент зарегистрирован: метка `nodeId` токена (или самого агента, если
   * токен общий) — привязка к этой ноде; иначе — к ноде без агента с тем же
   * именем. Иначе агент остаётся без ноды (привязка — вручную).
   */
  async onEnrolled(
    agent: AgentDto,
    source: IAgentEnrollmentSource,
  ): Promise<void> {
    const nodeId =
      source.labels[WG_NODE_ID_LABEL] ??
      (source.tokenId === null ? agent.labels[WG_NODE_ID_LABEL] : undefined);
    const node = nodeId
      ? await this._nodes.findEntity(nodeId).catch(() => null)
      : await this._nodes.findUnboundByName(agent.name);

    if (!node) {
      logger.warn(
        { agentId: agent.id, nodeId: nodeId ?? null },
        "[WG] Агент зарегистрирован без ноды",
      );

      return;
    }

    await this._attach(node.id, agent, source.createdBy ?? "");
  }

  /** Запись агента изменилась: состояние его ноды. */
  async onAgentUpdated(agent: AgentDto): Promise<void> {
    const node = await this._nodes.findByAgentId(agent.id);

    if (!node) return;

    await this._nodes.applyAgentState(node.id, wgNodeStateOf(agent));
  }

  /** Агент удалён: нода — без агента. */
  async onAgentGone(agentId: string): Promise<void> {
    await this._nodes.unbindAgent(agentId);
  }

  /** Нода удалена: её агента — отозвать и удалить (ошибки — в журнал). */
  async onNodeDeleted(agentId: string, actorId: string | null): Promise<void> {
    await this._agents
      .revokeAndDelete(actorId ?? "", agentId)
      .catch(err =>
        logger.warn({ err, agentId }, "[WG] Агент удалённой ноды не отозван"),
      );
  }

  /**
   * Агент удалён с машины: отозвать и удалить его запись, нода — без агента
   * (можно установить заново).
   */
  async detach(nodeId: string, actorId: string): Promise<void> {
    const node = await this._nodes.findEntity(nodeId);

    if (!node.agentId) return;

    await this._agents.revokeAndDelete(actorId, node.agentId);
    await this._nodes.unbindAgent(node.agentId);
  }

  /** Перезапуск интерфейса воркером wg (`wg-quick down && up`). */
  async restartInterface(
    nodeId: string,
    name: string,
    actorId: string,
  ): Promise<IWgInterfaceRestartResult> {
    const agentId = await this._requireAgent(nodeId);

    // Агент без связи — сразу 503: команда дождалась бы его, а ответ — нет.
    if (!this._core.isOnline(await this._core.get(agentId))) {
      throw AgentError.OFFLINE();
    }

    const queued = await this._core.workerCommand(
      agentId,
      WG_WORKER,
      WG_INTERFACE_RESTART_COMMAND,
      { name },
      { timeoutMs: RESTART_TIMEOUT_MS, actor: actorId },
    );
    const done = await this._core.wait(queued.id, RESTART_WAIT_MS);

    if (!done) throw AgentError.TIMEOUT();
    if (!done.ok) {
      throw WgNodeError.WORKER_FAILED(
        { code: done.error?.code },
        done.error?.message ?? "Интерфейс не перезапущен",
      );
    }

    return done.result as IWgInterfaceRestartResult;
  }

  private async _requireAgent(nodeId: string): Promise<string> {
    const node = await this._nodes.findEntity(nodeId);

    if (!node.agentId) throw WgNodeError.NO_AGENT();

    return node.agentId;
  }

  /** Привязка и сразу состояние ноды; прежний агент ноды — отозвать. */
  private async _attach(
    nodeId: string,
    agent: AgentDto,
    actorId: string,
  ): Promise<void> {
    const previous = await this._nodes.bindAgent(nodeId, agent.id);

    logger.info({ nodeId, agentId: agent.id }, "[WG] Агент привязан к ноде");
    await this._nodes.applyAgentState(nodeId, wgNodeStateOf(agent));

    if (previous) {
      await this._agents
        .revokeAs(actorId, previous)
        .catch(err =>
          logger.warn(
            { err, nodeId, agentId: previous },
            "[WG] Прежний агент ноды не отозван",
          ),
        );
    }
  }
}
