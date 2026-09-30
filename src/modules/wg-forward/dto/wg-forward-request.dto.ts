import type {
  EWgForwardPath,
  EWgForwardProtocol,
  EWgForwardRoute,
} from "../wg-forward.types";

export interface ICreateWgForwardBody {
  name: string;
  description?: string | null;
  relayNodeId: string;
  protocol: EWgForwardProtocol;
  listenPort: number;
  /** Нода-цель с агентом (обязательна для пути `ipip`). */
  targetNodeId?: string | null;
  /** Прямой адрес цели; пусто — publicHost ноды-цели. */
  targetHost?: string | null;
  targetPort: number;
  path: EWgForwardPath;
  route?: EWgForwardRoute;
  enabled?: boolean;
  /** Назначенный владелец; другой пользователь — только с правом назначения. */
  ownerId?: string | null;
}

export interface IUpdateWgForwardBody {
  name?: string;
  description?: string | null;
  listenPort?: number;
  targetNodeId?: string | null;
  targetHost?: string | null;
  targetPort?: number;
  path?: EWgForwardPath;
  route?: EWgForwardRoute;
  enabled?: boolean;
}

/** Назначение владельца проброса. */
export interface IAssignWgForwardBody {
  userId: string;
}
