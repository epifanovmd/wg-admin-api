import type {
  IWgInterfaceLive,
  IWgMeshMatrix,
  IWgNodeLive,
  IWgOverview,
  IWgPeerLive,
} from "../wg-stats.types";

/** Live-статистика пиров ноды за тик (при спросе — все, иначе — изменившиеся). */
export class WgPeersLiveStatsEvent {
  constructor(
    public readonly nodeId: string,
    public readonly lives: IWgPeerLive[],
  ) {}
}

/** Live-статистика интерфейса. */
export class WgInterfaceLiveStatsEvent {
  constructor(public readonly live: IWgInterfaceLive) {}
}

/** Live-статистика и системные метрики ноды. */
export class WgNodeLiveStatsEvent {
  constructor(public readonly live: IWgNodeLive) {}
}

/** Сводка дашборда обновилась. */
export class WgOverviewUpdatedEvent {
  constructor(public readonly overview: IWgOverview) {}
}

/** Матрица связности нод обновилась (пришли пробы агента). */
export class WgMeshUpdatedEvent {
  constructor(public readonly matrix: IWgMeshMatrix) {}
}

/** Пришли пробы IPIP-линков: здоровье линков этих нод изменилось. */
export class WgLinksProbedEvent {
  constructor(public readonly nodeIds: string[]) {}
}
