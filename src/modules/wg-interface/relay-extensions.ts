import type { TokenProvider } from "../../core";

/**
 * Другие модули, которым нужен релей: цели их туннелей (линки) и порты,
 * которые они занимают на ноде. wg-interface не зависит от них — они
 * регистрируют реализацию (`asWgRelayConsumer(Cls)`).
 */
export const WG_RELAY_CONSUMER = Symbol("WgRelayConsumer");

export interface IWgRelayConsumer {
  /** Ноды, до которых релею нужен IPIP-линк (помимо интерфейсов). */
  ipipTargetsOfRelay(relayNodeId: string): Promise<string[]>;
  /** Порты, занятые на ноде как релее. */
  claimedPorts(
    nodeId: string,
  ): Promise<Array<{ protocol: "udp" | "tcp"; port: number; ownerId: string }>>;
}

export const asWgRelayConsumer = (
  consumer: new (...args: any[]) => IWgRelayConsumer,
): TokenProvider<IWgRelayConsumer> => ({
  provide: WG_RELAY_CONSUMER,
  useClass: consumer,
});
