import { inject } from "inversify";

import {
  AgentCommandFinishedEvent,
  AgentCommandProgressEvent,
  AgentCommandQueuedEvent,
  AgentConfigAppliedEvent,
  AgentConfigChangedEvent,
  AgentDeletedEvent,
  AgentEventReceivedEvent,
  AgentLogReceivedEvent,
  AgentMetricsReceivedEvent,
  Agents,
  AgentUpdatedEvent,
  EventBus,
  Injectable,
  logger,
} from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { AgentService } from "./agent.service";
import { agentRoom, AGENTS_ROOM } from "./agent.types";
import { toCommandDto, toConfigDto, toLogEntryDto } from "./dto";

const roomsOf = (agentId: string): string[] => [
  AGENTS_ROOM,
  agentRoom(agentId),
];

/**
 * События агентов → сокет. Список (`agents`) — изменения агентов и события воркеров; комната
 * агента — то же по нему и вдобавок метрики, журнал, настройки и команды.
 */
@Injectable()
export class AgentListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(AgentService) private readonly _service: AgentService,
    @inject(Agents) private readonly _agents: Agents,
  ) {}

  register(): void {
    const on = this._eventBus.on.bind(this._eventBus);
    const emitter = this._emitter;

    on(AgentUpdatedEvent, async ({ agent }) =>
      emitter.toRooms(
        roomsOf(agent.id),
        "agent:updated",
        await this._service.toDto(agent),
      ),
    );
    on(AgentDeletedEvent, ({ agentId }) =>
      emitter.toRooms(roomsOf(agentId), "agent:deleted", { id: agentId }),
    );
    on(AgentEventReceivedEvent, ({ agentId, event }) =>
      emitter.toRooms(roomsOf(agentId), "agent:event", {
        agentId,
        id: event.id,
        worker: event.worker,
        type: event.type,
        data: event.data,
        at: event.at,
        receivedAt: Date.now(),
      }),
    );
    const config = async (agentId: string, worker: string, key: string) => {
      const agent = await this._agents.find(agentId);
      const status =
        agent &&
        (await this._agents.configStatus(agent)).find(
          s => s.worker === worker && s.key === key,
        );

      if (status)
        emitter.toRoom(
          agentRoom(agentId),
          "agent:config",
          toConfigDto(agentId, status),
        );
    };

    on(AgentConfigChangedEvent, e => {
      if (e.deleted) {
        emitter.toRoom(agentRoom(e.agentId), "agent:config", {
          agentId: e.agentId,
          worker: e.worker,
          key: e.key,
          version: e.version,
          state: "pending",
          deleted: true,
          updatedAt: Date.now(),
        });

        return;
      }
      config(e.agentId, e.worker, e.key).catch(err =>
        logger.warn({ err }, "[Agent] agent:config"),
      );
    });
    on(AgentConfigAppliedEvent, e =>
      config(e.agentId, e.worker, e.key).catch(err =>
        logger.warn({ err }, "[Agent] agent:config"),
      ),
    );
    for (const Event of [
      AgentCommandQueuedEvent,
      AgentCommandProgressEvent,
      AgentCommandFinishedEvent,
    ]) {
      on(Event, ({ command }) =>
        emitter.toRoom(
          agentRoom(command.agentId),
          "agent:command",
          toCommandDto(command),
        ),
      );
    }
    on(AgentMetricsReceivedEvent, ({ agentId, point }) =>
      emitter.toRoom(agentRoom(agentId), "agent:metrics", { agentId, point }),
    );
    on(AgentLogReceivedEvent, ({ agentId, entries }) =>
      emitter.toRoom(agentRoom(agentId), "agent:log", {
        agentId,
        entries: entries.map(toLogEntryDto),
      }),
    );
  }
}
