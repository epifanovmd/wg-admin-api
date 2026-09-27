import type { TokenProvider } from "../../core";

/** Токен multi-inject источников «кто использует точку подключения». */
export const WG_ENDPOINT_USAGE = Symbol("WgEndpointUsage");

/**
 * Использование точки подключения. Модуль wg-endpoint не зависит от
 * потребителей: реализацию регистрирует модуль интерфейсов
 * (`asWgEndpointUsage(Cls)`).
 */
export interface IWgEndpointUsage {
  /** id нод, чьи интерфейсы подключаются через точку. */
  targetNodeIds(endpointId: string): Promise<string[]>;
  /** Порты интерфейсов точки заняты на релей-ноде (её интерфейсами или другими точками). */
  relayPortConflict(endpointId: string, relayNodeId: string): Promise<boolean>;
}

export const asWgEndpointUsage = (
  usage: new (...args: any[]) => IWgEndpointUsage,
): TokenProvider<IWgEndpointUsage> => ({
  provide: WG_ENDPOINT_USAGE,
  useClass: usage,
});
