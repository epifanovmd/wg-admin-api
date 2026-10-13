import { inject } from "inversify";

import {
  AgentDeletedEvent,
  AgentEnrolledEvent,
  AgentUpdatedEvent,
  EventBus,
  Injectable,
  logger,
} from "../../core";
import { AgentService } from "../agent";
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
    @inject(AgentService) private readonly _views: AgentService,
  ) {}

  register(): void {
    const guard =
      <T>(what: string, fn: (event: T) => Promise<void>) =>
      (event: T): Promise<void> =>
        fn(event).catch(err => logger.warn({ err }, `[WG] ${what}`));

    this._eventBus.on(
      AgentEnrolledEvent,
      guard("Привязка агента к ноде", async ({ agent, source }) =>
        this._agents.onEnrolled(await this._views.toDto(agent), source),
      ),
    );
    this._eventBus.on(
      AgentUpdatedEvent,
      guard("Состояние ноды по агенту", async ({ agent }) =>
        this._agents.onAgentUpdated(await this._views.toDto(agent)),
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
