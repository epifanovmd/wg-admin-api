import { inject } from "inversify";
import { isDeepStrictEqual } from "util";

import { Injectable, logger } from "../../core";
import { AgentWorkerService } from "../agent";
import {
  SOCKS_PROXIES_CONFIG,
  SOCKS_WORKER,
  WG_PROBES_CONFIG,
  WG_STATE_CONFIG,
  WG_WORKER,
  WgNodeService,
} from "../wg-node";
import { WgAgentStateService } from "./wg-agent-state.service";

/** Изменения ноды копятся столько перед сборкой настроек. */
const COALESCE_MS = 50;

/** Ключ настроек воркера и его значение. */
interface IConfigEntry {
  worker: string;
  key: string;
  data: unknown;
}

/**
 * Доставка домена на ноды: настройки воркеров агента ноды (`wg/state`,
 * `wg/probes`, `socks/proxies`) собираются из БД и записываются в хранилище
 * агентов, только если значение изменилось. Агент на связи получает новую
 * версию сразу, без связи — при подключении. Изменения одной ноды
 * склеиваются (`COALESCE_MS`), сборки одной ноды не пересекаются.
 */
@Injectable()
export class WgAgentSyncService {
  private readonly _pending = new Set<string>();
  private _all = false;
  private _timer: NodeJS.Timeout | null = null;
  /** Ноды, которые синхронизируются сейчас; значение — нужен повтор. */
  private readonly _running = new Map<string, boolean>();

  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgAgentStateService) private readonly _state: WgAgentStateService,
    @inject(AgentWorkerService) private readonly _workers: AgentWorkerService,
  ) {}

  /** Запланировать синхронизацию ноды. */
  schedule(nodeId: string): void {
    this._pending.add(nodeId);
    this._arm();
  }

  /** Запланировать синхронизацию всех нод с агентами. */
  scheduleAll(): void {
    this._all = true;
    this._arm();
  }

  /** Остановить таймер (остановка процесса). */
  stop(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._pending.clear();
    this._all = false;
  }

  /**
   * Синхронизировать ноду сейчас: ключи, чьё значение отличается от
   * записанного, получают новую версию. Нода без агента — ничего.
   */
  async sync(nodeId: string): Promise<void> {
    if (this._running.has(nodeId)) {
      this._running.set(nodeId, true);

      return;
    }

    this._running.set(nodeId, false);
    try {
      do {
        this._running.set(nodeId, false);
        await this._syncOnce(nodeId);
      } while (this._running.get(nodeId));
    } finally {
      this._running.delete(nodeId);
    }
  }

  private async _syncOnce(nodeId: string): Promise<void> {
    const node = await this._nodes.findEntity(nodeId).catch(() => null);

    if (!node?.agentId) return;

    const configs = await this._state.build(node.id);

    if (!configs) return;

    const entries: IConfigEntry[] = [
      { worker: WG_WORKER, key: WG_STATE_CONFIG, data: configs.state },
      { worker: WG_WORKER, key: WG_PROBES_CONFIG, data: configs.probes },
      {
        worker: SOCKS_WORKER,
        key: SOCKS_PROXIES_CONFIG,
        data: configs.proxies,
      },
    ];

    for (const entry of entries) {
      await this._put(node.agentId, entry);
    }
  }

  private async _put(agentId: string, entry: IConfigEntry): Promise<void> {
    const current = await this._workers.findConfig(
      agentId,
      entry.worker,
      entry.key,
    );

    if (current && isDeepStrictEqual(current.data, entry.data)) return;

    const written = await this._workers.putConfig(
      agentId,
      entry.worker,
      entry.key,
      entry.data,
    );

    logger.debug(
      {
        agentId,
        worker: entry.worker,
        key: entry.key,
        version: written.version,
      },
      "[WG] Настройка воркера записана",
    );
  }

  private _arm(): void {
    this._timer ??= setTimeout(() => void this._flush(), COALESCE_MS);
  }

  private async _flush(): Promise<void> {
    this._timer = null;

    const ids = this._all
      ? (await this._nodes.boundNodes().catch(() => [])).map(node => node.id)
      : [];

    for (const id of this._pending) ids.push(id);
    this._pending.clear();
    this._all = false;

    for (const nodeId of new Set(ids)) {
      await this.sync(nodeId).catch(err =>
        logger.warn({ err, nodeId }, "[WG] Настройки ноды не записаны"),
      );
    }
  }
}
