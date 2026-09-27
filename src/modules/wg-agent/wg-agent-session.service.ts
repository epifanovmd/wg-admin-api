import { inject } from "inversify";

import { Injectable } from "../../core";
import { ApiKeyService } from "../api-key";
import { WgForwardService } from "../wg-forward";
import { EWgInterfaceStatus, WgInterfaceService } from "../wg-interface";
import { WgInterfaceReplicaService } from "../wg-interface";
import type { WgNode } from "../wg-node";
import { wgAgentScope, WgNodeService } from "../wg-node";
import { WgSocksAppService } from "../wg-socks";
import {
  EWgAgentTransport,
  IWgIngestResult,
  WgLinkHealthService,
  WgMeshService,
  WgStatsIngestService,
} from "../wg-stats";
import type {
  IWgAgentReportBody,
  IWgAgentStatsBody,
} from "./wg-agent-protocol";

/** Агент, предъявивший ключ: нода и id ключа (для перепроверки отзыва). */
export interface IWgAgentIdentity {
  node: WgNode;
  keyId: string;
}

/**
 * Протокол агента независимо от канала: отчёт о состоянии и статистика
 * одинаково принимаются по HTTP и через постоянное соединение.
 */
@Injectable()
export class WgAgentSessionService {
  constructor(
    @inject(ApiKeyService) private readonly _keys: ApiKeyService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgInterfaceService)
    private readonly _interfaces: WgInterfaceService,
    @inject(WgInterfaceReplicaService)
    private readonly _replicas: WgInterfaceReplicaService,
    @inject(WgStatsIngestService)
    private readonly _ingest: WgStatsIngestService,
    @inject(WgLinkHealthService)
    private readonly _links: WgLinkHealthService,
    @inject(WgMeshService) private readonly _mesh: WgMeshService,
    @inject(WgForwardService)
    private readonly _forwards: WgForwardService,
    @inject(WgSocksAppService) private readonly _socks: WgSocksAppService,
  ) {}

  /** Нода по ключу агента; ключ без scope агента или без ноды — ошибка 401/403. */
  async authenticate(rawKey: string): Promise<IWgAgentIdentity> {
    const apiKey = await this._keys.verify(rawKey);
    const node = await this._nodes.findByAgentScopes(apiKey.scopes);

    return { node, keyId: apiKey.id };
  }

  /** Ключ всё ещё действует и принадлежит ноде (отзыв, ротация, истечение). */
  async isKeyValid(rawKey: string, nodeId: string): Promise<boolean> {
    try {
      const apiKey = await this._keys.verify(rawKey);

      return apiKey.scopes.includes(wgAgentScope(nodeId));
    } catch {
      return false;
    }
  }

  /** Отчёт агента: применённая версия, ошибки, версии ПО, ОС, статусы интерфейсов. */
  async report(node: WgNode, body: IWgAgentReportBody): Promise<void> {
    await this._nodes.reportAgentState(node, {
      appliedVersion: body.appliedVersion,
      applyError: body.applyError,
      agentVersion: body.agentVersion,
      wgVersion: body.wgVersion,
      codeHash: body.codeHash,
      osInfo: body.os,
    });

    if (body.interfaces) {
      await this._interfaces.updateReportedStatuses(
        node.id,
        body.interfaces.map(report => ({
          name: report.name,
          status: report.status as EWgInterfaceStatus,
          message: report.message,
        })),
      );
    }
  }

  /**
   * Тик статистики: трафик и метрики, пробы туннелей и нод, маршруты
   * пробросов, прокси. Повтор тика (досылка) не учитывается повторно.
   */
  async stats(
    node: WgNode,
    body: IWgAgentStatsBody,
    transport: EWgAgentTransport,
  ): Promise<IWgIngestResult> {
    const result = await this._ingest.ingest(node, body, transport);

    // Пробы и маршруты — состояние «сейчас»: из досылки не берутся.
    if (result.duplicate || result.backfill) return result;

    if (body.tunnels) await this._links.recordProbes(node.id, body.tunnels);
    if (body.forwards) {
      await this._forwards.recordRoutes(node.id, body.forwards);
      await this._replicas.recordServingNodes(node.id, body.forwards);
    }
    if (body.socks) await this._socks.recordStats(node.id, body.socks);
    if (body.nodeProbes) {
      await this._mesh.recordProbes(node.id, body.nodeProbes);
    }

    return result;
  }
}
