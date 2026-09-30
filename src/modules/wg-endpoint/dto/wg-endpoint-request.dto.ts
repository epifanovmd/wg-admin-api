import type {
  EWgEndpointMode,
  EWgEndpointRoute,
  EWgForwardMode,
} from "../wg-endpoint.types";

export interface ICreateWgEndpointBody {
  name: string;
  description?: string | null;
  /** Хост (IP/домен), который попадает в клиентские конфиги. */
  host: string;
  mode: EWgEndpointMode;
  /** Обязательна для mode=relay. */
  relayNodeId?: string | null;
  forwardMode?: EWgForwardMode;
  /** Маршрут при IPIP: по умолчанию `auto` (запасной прямой путь). */
  route?: EWgEndpointRoute;
  /** Назначенный владелец; другой пользователь — только с правом назначения. */
  ownerId?: string | null;
}

export interface IUpdateWgEndpointBody {
  name?: string;
  description?: string | null;
  host?: string;
  mode?: EWgEndpointMode;
  relayNodeId?: string | null;
  forwardMode?: EWgForwardMode;
  route?: EWgEndpointRoute;
}

/** Назначение владельца точки подключения. */
export interface IAssignWgEndpointBody {
  userId: string;
}
