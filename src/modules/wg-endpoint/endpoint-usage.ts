import type { TokenProvider } from "../../core";

/** Токен multi-inject источников «кто использует точку подключения». */
export const WG_ENDPOINT_USAGE = Symbol("WgEndpointUsage");

/**
 * Использование точки подключения. Модуль wg-endpoint не зависит от
 * потребителей: реализацию регистрирует модуль интерфейсов
 * (`asWgEndpointUsage(Cls)`).
 */
/** Интерфейс, подключённый через точку: куда она ведёт. */
export interface IWgEndpointInterfaceDto {
  interfaceId: string;
  interfaceName: string;
  /** Нода интерфейса (основная копия). */
  nodeId: string;
  nodeName: string | null;
  /** Порт клиентов на точке: отдельный порт точки или порт интерфейса. */
  port: number;
  /** Ноды копий интерфейса по приоритету. */
  copyNodeIds: string[];
}

export interface IWgEndpointUsage {
  /** id нод, чьи интерфейсы подключаются через точку. */
  targetNodeIds(endpointId: string): Promise<string[]>;
  /** Интерфейсы точек по id точки — одним запросом на список. */
  interfacesByEndpoint(
    endpointIds: string[],
  ): Promise<Record<string, IWgEndpointInterfaceDto[]>>;
  /** Порты интерфейсов точки заняты на релей-ноде (её интерфейсами или другими точками). */
  relayPortConflict(endpointId: string, relayNodeId: string): Promise<boolean>;
}

export const asWgEndpointUsage = (
  usage: new (...args: any[]) => IWgEndpointUsage,
): TokenProvider<IWgEndpointUsage> => ({
  provide: WG_ENDPOINT_USAGE,
  useClass: usage,
});
