import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import {
  AgentDeletedEvent,
  AgentEnrolledEvent,
  AgentUpdatedEvent,
} from "../agent";
import { ISocketEventListener } from "../socket";
import { WgNodeDeletedEvent } from "./events";
import { WgNodeAgentService } from "./wg-node-agent.service";

/**
 * Агенты ↔ ноды: новый агент привязывается к своей ноде, изменение записи
 * агента (связь, воркеры, версии) — состояние ноды, удалённый агент — нода
 * без агента, удалённая нода — её агент отзывается.
 */
@Injectable()
export class WgNodeAgentListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(WgNodeAgentService) private readonly _agents: WgNodeAgentService,
  ) {}

  register(): void {
    const guard =
      <T>(what: string, fn: (event: T) => Promise<void>) =>
      (event: T): Promise<void> =>
        fn(event).catch(err => logger.warn({ err }, `[WG] ${what}`));

    this._eventBus.on(
      AgentEnrolledEvent,
      guard("Привязка агента к ноде", ({ agent, source }) =>
        this._agents.onEnrolled(agent, source),
      ),
    );
    this._eventBus.on(
      AgentUpdatedEvent,
      guard("Состояние ноды по агенту", ({ agent }) =>
        this._agents.onAgentUpdated(agent),
      ),
    );
    this._eventBus.on(
      AgentDeletedEvent,
      guard("Отвязка удалённого агента", ({ agentId }) =>
        this._agents.onAgentGone(agentId),
      ),
    );
    this._eventBus.on(
      WgNodeDeletedEvent,
      guard("Отзыв агента удалённой ноды", async ({ agentId, actorId }) => {
        if (agentId) await this._agents.onNodeDeleted(agentId, actorId);
      }),
    );
  }
}
