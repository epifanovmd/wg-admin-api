import { inject } from "inversify";

import {
  IJobHandler,
  Injectable,
  JobContext,
  JobDefinition,
  logger,
} from "../../core";
import { WgNodeService } from "../wg-node";

export const WG_AGENT_LINK_LOST_QUEUE = "wg.agent-link-lost";

export interface IWgAgentLinkLostData {
  nodeId: string;
  /** Момент разрыва соединения (ISO). */
  disconnectedAt: string;
}

/**
 * Постоянное соединение агента разорвано: если с момента разрыва агент не
 * выходил на связь (ни новым соединением, ни по HTTP), нода — offline сразу,
 * не дожидаясь общего порога молчания.
 */
@Injectable()
export class WgAgentLinkLostJob implements IJobHandler<IWgAgentLinkLostData> {
  readonly definition: JobDefinition = {
    queue: WG_AGENT_LINK_LOST_QUEUE,
    retryLimit: 2,
  };

  constructor(@inject(WgNodeService) private readonly _nodes: WgNodeService) {}

  async handle(ctx: JobContext<IWgAgentLinkLostData>): Promise<void> {
    const { nodeId, disconnectedAt } = ctx.data;

    if (
      await this._nodes.markOfflineIfSilent(nodeId, new Date(disconnectedAt))
    ) {
      logger.warn({ nodeId }, "[WG] agent link lost — node offline");
    }
  }
}
