import { inject } from "inversify";

import { Injectable } from "../../core";
import type { IWgRelayConsumer } from "../wg-interface";
import { WgSocksServiceRepository } from "./wg-socks.repository";

/** TCP-порты прокси на ноде — для проверок пробросов и других модулей. */
@Injectable()
export class WgSocksPortClaims implements IWgRelayConsumer {
  constructor(
    @inject(WgSocksServiceRepository)
    private readonly _services: WgSocksServiceRepository,
  ) {}

  async ipipTargetsOfRelay(): Promise<string[]> {
    return [];
  }

  async claimedPorts(nodeId: string) {
    const services = await this._services.find({
      where: { nodeId },
      select: { id: true, listenPort: true },
    });

    return services.map(service => ({
      protocol: "tcp" as const,
      port: service.listenPort,
      ownerId: service.id,
    }));
  }
}
