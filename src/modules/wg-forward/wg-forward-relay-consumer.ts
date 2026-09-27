import { inject } from "inversify";

import { Injectable } from "../../core";
import type { IWgRelayConsumer } from "../wg-interface";
import { WgForwardRepository } from "./wg-forward.repository";

/** Пробросы для модуля интерфейсов: цели туннелей и занятые порты релея. */
@Injectable()
export class WgForwardRelayConsumer implements IWgRelayConsumer {
  constructor(
    @inject(WgForwardRepository) private readonly _repo: WgForwardRepository,
  ) {}

  ipipTargetsOfRelay(relayNodeId: string): Promise<string[]> {
    return this._repo.ipipTargetsOfRelay(relayNodeId);
  }

  async claimedPorts(nodeId: string) {
    return (await this._repo.listenPortsOn(nodeId)).map(item => ({
      protocol: item.protocol,
      port: item.port,
      ownerId: item.id,
    }));
  }
}
