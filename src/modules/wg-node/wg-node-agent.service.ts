import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import type { AuthContext } from "../../types/koa";
import {
  AgentDto,
  AgentEnrollmentService,
  AgentService,
  AgentWorkerService,
  IAgentEnrollmentSource,
  IAgentUpdateResultDto,
  IAgentWorkerActionResultDto,
} from "../agent";
import type {
  ICreateWgNodeInstallCommandBody,
  IWgNodeInstallCommandDto,
  IWgNodeLogsDto,
} from "./dto";
import { WgNode } from "./wg-node.entity";
import { WgNodeError } from "./wg-node.errors";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeService } from "./wg-node.service";
import {
  WG_AGENT_LOGS_DEFAULT_LINES,
  WG_NODE_ID_LABEL,
  WG_NODE_INSTALL_TOKEN_TTL_MINUTES,
  WG_NODE_WORKERS,
  WG_WORKER,
} from "./wg-node.types";
import { wgNodeStateOf } from "./wg-node-status";

const MINUTE_MS = 60_000;

/** Срок перезапуска интерфейса: wg-quick down/up на воркере. */
const RESTART_TIMEOUT_MS = 90_000;

/**
 * Пакеты узла для воркера wg: wg-quick, ip, iptables, conntrack, ping.
 * Имена различаются у менеджеров пакетов.
 */
const NODE_PACKAGES = {
  apt: ["wireguard-tools", "iproute2", "iptables", "conntrack", "iputils-ping"],
  dnf: ["wireguard-tools", "iproute", "iptables", "conntrack-tools", "iputils"],
  yum: ["wireguard-tools", "iproute", "iptables", "conntrack-tools", "iputils"],
  apk: [
    "wireguard-tools",
    "iproute2",
    "iptables",
    "conntrack-tools",
    "iputils",
  ],
  zypper: [
    "wireguard-tools",
    "iproute2",
    "iptables",
    "conntrack-tools",
    "iputils",
  ],
};

/** Параметры ядра для пробросов и NAT. */
const NODE_SYSCTL = {
  "net.ipv4.ip_forward": "1",
  "net.ipv6.conf.all.forwarding": "1",
};

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

const formatEntry = (entry: IWgNodeLogsDto["entries"][number]): string =>
  `${new Date(entry.at).toISOString()} ${entry.level} ${entry.source}: ${entry.msg}`;

const messageOf = (body: unknown): string | null =>
  body && typeof body === "object" && "message" in body
    ? String((body as { message: unknown }).message)
    : typeof body === "string" && body
      ? body
      : null;

/**
 * Агент ноды (agent-sdk): токен регистрации с меткой ноды и команда
 * установки, привязка агента после регистрации, состояние ноды по агенту,
 * запросы к воркеру wg (перезапуск интерфейса), журнал, обновления агента и
 * воркеров, отвязка при отзыве и удалении.
 */
@Injectable()
export class WgNodeAgentService {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(AgentService) private readonly _agents: AgentService,
    @inject(AgentWorkerService) private readonly _workers: AgentWorkerService,
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
   * Команда установки агента ноды: экземпляр проекта (`--instance`),
   * воркеры wg и socks из выпуска, права root (воркер настраивает сеть),
   * пакеты и параметры ядра для WireGuard, пробросов и NAT.
   */
  commandFor(
    node: Pick<WgNode, "name">,
    auth: { token: string } | { tokenFile: string },
    baseUrl?: string,
  ): string {
    return this._agents.installCommand({
      ...auth,
      ...(baseUrl && { baseUrl }),
      name: node.name,
      privileged: true,
      workers: [...WG_NODE_WORKERS],
      packages: NODE_PACKAGES.apt,
      packagesByManager: {
        dnf: NODE_PACKAGES.dnf,
        yum: NODE_PACKAGES.yum,
        apk: NODE_PACKAGES.apk,
        zypper: NODE_PACKAGES.zypper,
      },
      sysctl: NODE_SYSCTL,
    }).command;
  }

  /** Экземпляр агента проекта на узле (`--instance`); пусто — по умолчанию. */
  instance(): string | undefined {
    return this._agents.instance();
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
    const response = await this._workers.request(
      agentId,
      WG_WORKER,
      `/interfaces/${encodeURIComponent(name)}/restart`,
      { method: "POST", actorId, timeoutMs: RESTART_TIMEOUT_MS },
    );

    if (response.status >= 300) {
      throw WgNodeError.WORKER_FAILED(
        { status: response.status },
        messageOf(response.body) ?? undefined,
      );
    }

    return response.body as IWgInterfaceRestartResult;
  }

  /** Журнал агента (или воркера) ноды с узла. */
  async logs(
    actor: AuthContext,
    id: string,
    query: { lines?: number; worker?: string },
  ): Promise<IWgNodeLogsDto> {
    await this._nodes.findFor(actor, id, WgNodePermissions.NODE_LOGS);

    const agentId = await this._requireAgent(id);
    const entries = await this._agents.logsOf(agentId, {
      lines: query.lines ?? WG_AGENT_LOGS_DEFAULT_LINES,
      ...(query.worker && { worker: query.worker }),
    });

    return { content: entries.map(formatEntry).join("\n"), entries };
  }

  /** Обновить агента ноды до версии выпуска. */
  async updateAgent(
    actor: AuthContext,
    id: string,
  ): Promise<IAgentUpdateResultDto> {
    await this._nodes.findFor(actor, id, WgNodePermissions.NODE_AGENT);

    return this._agents.updateAs(actor.userId, await this._requireAgent(id));
  }

  /** Обновить воркер агента ноды из выпуска. */
  async updateWorker(
    actor: AuthContext,
    id: string,
    worker: string,
    force: boolean,
  ): Promise<IAgentWorkerActionResultDto> {
    await this._nodes.findFor(actor, id, WgNodePermissions.NODE_AGENT);

    return this._workers.updateAs(
      actor.userId,
      await this._requireAgent(id),
      worker,
      force,
    );
  }

  /** Перезапустить воркер агента ноды. */
  async restartWorker(
    actor: AuthContext,
    id: string,
    worker: string,
    force: boolean,
  ): Promise<IAgentWorkerActionResultDto> {
    await this._nodes.findFor(actor, id, WgNodePermissions.NODE_AGENT);

    return this._workers.restartAs(
      actor.userId,
      await this._requireAgent(id),
      worker,
      force,
    );
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
