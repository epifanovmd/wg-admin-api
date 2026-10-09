import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { agentRoom, AGENTS_ROOM } from "./agent.types";
import {
  AgentActionFinishedEvent,
  AgentAlertChangedEvent,
  AgentConfigChangedEvent,
  AgentDeletedEvent,
  AgentEventReceivedEvent,
  AgentLogReceivedEvent,
  AgentMetricsReceivedEvent,
  AgentReleaseChangedEvent,
  AgentUpdatedEvent,
} from "./events";

/** Комната списка и комната агента. */
const roomsOf = (agentId: string): string[] => [
  AGENTS_ROOM,
  agentRoom(agentId),
];

/**
 * События агентов → сокет. Список (`agents`) получает изменения агентов,
 * проблемы и события воркеров; комната агента — то же по нему и вдобавок
 * метрики, журнал, статусы настроек и итоги действий. Сокет в обеих
 * комнатах получает событие один раз. Новая версия агента в источнике —
 * всем клиентам (выпуск виден любому вошедшему).
 */
@Injectable()
export class AgentListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    const on = this._eventBus.on.bind(this._eventBus);
    const emitter = this._emitter;

    on(AgentUpdatedEvent, ({ agent }) =>
      emitter.toRooms(roomsOf(agent.id), "agent:updated", agent),
    );
    on(AgentDeletedEvent, ({ agentId }) =>
      emitter.toRooms(roomsOf(agentId), "agent:deleted", { id: agentId }),
    );
    on(AgentAlertChangedEvent, ({ alert }) =>
      emitter.toRooms(roomsOf(alert.agentId), "agent:alert", alert),
    );
    on(AgentEventReceivedEvent, ({ event }) =>
      emitter.toRooms(roomsOf(event.agentId), "agent:event", event),
    );
    on(AgentConfigChangedEvent, ({ status }) =>
      emitter.toRoom(agentRoom(status.agentId), "agent:config", status),
    );
    on(AgentActionFinishedEvent, ({ action }) =>
      emitter.toRoom(agentRoom(action.agentId), "agent:action", action),
    );
    on(AgentMetricsReceivedEvent, ({ agentId, point }) =>
      emitter.toRoom(agentRoom(agentId), "agent:metrics", { agentId, point }),
    );
    on(AgentReleaseChangedEvent, ({ release }) =>
      emitter.broadcast("agent:release", release),
    );
    on(AgentLogReceivedEvent, ({ agentId, entries }) =>
      emitter.toRoom(agentRoom(agentId), "agent:log", { agentId, entries }),
    );
  }
}
