import { getRedis, Injectable, LiveStore } from "../../core";

const NODES_SET = "wg:cur:node-ids";

/**
 * Live-состояние статистики, общее для процессов: текущие снимки, счётчики,
 * отметки последней записи (механизм — `LiveStore` ядра), плюс список нод,
 * присылавших статистику, для сборки overview.
 */
@Injectable()
export class WgLiveStore extends LiveStore {
  private readonly _nodesRedis = getRedis();
  private readonly _memNodes = new Set<string>();

  constructor() {
    super("wg:cur:");
  }

  /** Зарегистрировать ноду в списке активных (для сборки overview). */
  async registerNode(nodeId: string): Promise<void> {
    if (this._nodesRedis) {
      await this._nodesRedis.sadd(NODES_SET, nodeId);

      return;
    }

    this._memNodes.add(nodeId);
  }

  async activeNodeIds(): Promise<string[]> {
    if (this._nodesRedis) return this._nodesRedis.smembers(NODES_SET);

    return [...this._memNodes];
  }
}
