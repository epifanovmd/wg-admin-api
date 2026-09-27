import type { EWgEndpointMode, EWgForwardMode } from "../wg-endpoint.types";

export interface ICreateWgEndpointBody {
  name: string;
  description?: string | null;
  /** Хост (IP/домен), который попадает в клиентские конфиги. */
  host: string;
  mode: EWgEndpointMode;
  /** Обязательна для mode=relay. */
  relayNodeId?: string | null;
  forwardMode?: EWgForwardMode;
}

export interface IUpdateWgEndpointBody {
  name?: string;
  description?: string | null;
  host?: string;
  mode?: EWgEndpointMode;
  relayNodeId?: string | null;
  forwardMode?: EWgForwardMode;
}
