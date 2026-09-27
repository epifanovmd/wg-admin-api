/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type {
  IWgInterfaceLive,
  IWgLinkHealth,
  IWgMeshMatrix,
  IWgNodeLive,
  IWgOverview,
  IWgPeerLive,
} from "./wg-stats.types";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /**
     * Статистика пиров за тик — одним событием: `wg-overview` — все пиры,
     * комнаты интерфейса, «мои пиры» (`wg-peers-own`) и пира — своя часть.
     */
    "wg:peers:stats": (...args: [{ peers: IWgPeerLive[] }]) => void;
    /** Live-статистика интерфейса — комната интерфейса. */
    "wg:interface:stats": (...args: [IWgInterfaceLive]) => void;
    /** Live-статистика и метрики ноды — комната ноды. */
    "wg:node:stats": (...args: [IWgNodeLive]) => void;
    /** Сводка дашборда — комната `wg-overview`. */
    "wg:stats:overview": (...args: [IWgOverview]) => void;
    /** Матрица связности нод — комната `wg-overview`. */
    "wg:stats:mesh": (...args: [IWgMeshMatrix]) => void;
    /** Здоровье IPIP-линков ноды — комната ноды. */
    "wg:node:links": (
      ...args: [{ nodeId: string; links: IWgLinkHealth[] }]
    ) => void;
  }
}
