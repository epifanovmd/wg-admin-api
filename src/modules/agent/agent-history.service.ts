import type { AgentEvent } from "agent-sdk/server";
import { inject } from "inversify";

import type { ICursorPageDto } from "../../core";
import { decodeCursor, encodeCursor, Injectable } from "../../core";
import { agentConfig } from "./agent.config";
import { AgentWorkerEvent } from "./agent-worker-event.entity";
import {
  AgentWorkerEventRepository,
  IAgentEventFilter,
} from "./agent-worker-event.repository";
import { IAgentEventDto } from "./dto";
import { jsonSafe } from "./store/agent.store";

const DAY_MS = 86_400_000;

/** Курсор ленты событий: последняя запись прошлой страницы. */
interface IEventCursor extends Record<string, unknown> {
  receivedAt: number;
  id: string;
}

const isEventCursor = (value: unknown): value is IEventCursor =>
  !!value &&
  typeof (value as IEventCursor).receivedAt === "number" &&
  typeof (value as IEventCursor).id === "string";

export const toAgentEventDto = (
  event: AgentEvent | AgentWorkerEvent,
  problems = "problems" in event ? event.problems : null,
): IAgentEventDto => ({
  id: event.id,
  agentId: event.agentId,
  worker: event.worker,
  type: event.type,
  ...(event.data !== undefined && event.data !== null && { data: event.data }),
  at: event.at,
  receivedAt: event.receivedAt,
  ...(problems?.length && { problems }),
});

/** Параметры ленты событий (область агентов решена вызывающим). */
export interface IAgentEventFeedQuery {
  agentIds?: string[];
  worker?: string;
  type?: string;
  cursor?: string;
  limit: number;
}

/**
 * История агентов, которую SDK не хранит: события воркеров (с отсечкой
 * повторной доставки по id сообщения агента), уборка по сроку. Метрики
 * узлов и воркеров пишут модули домена в свои таблицы.
 */
@Injectable()
export class AgentHistoryService {
  constructor(
    @inject(AgentWorkerEventRepository)
    private readonly _events: AgentWorkerEventRepository,
  ) {}

  /** Сохранить событие; `false` — оно уже было (повтор доставки). */
  saveEvent(event: AgentEvent, problems?: string[] | null): Promise<boolean> {
    return this._events.insertIfNew(
      this._events.create({
        agentId: event.agentId,
        id: event.id,
        worker: event.worker,
        type: event.type,
        data: event.data === undefined ? null : jsonSafe(event.data),
        at: event.at,
        receivedAt: event.receivedAt,
        problems: problems?.length ? problems : null,
      }),
    );
  }

  async eventFeed(
    query: IAgentEventFeedQuery,
  ): Promise<ICursorPageDto<IAgentEventDto>> {
    const decoded = decodeCursor<IEventCursor>(query.cursor);
    const filter: IAgentEventFilter = {
      agentIds: query.agentIds,
      worker: query.worker,
      type: query.type,
      before: isEventCursor(decoded) ? decoded : undefined,
      limit: query.limit,
    };
    const rows = await this._events.findFeed(filter);
    const last = rows[rows.length - 1];

    return {
      items: rows.map(row => toAgentEventDto(row)),
      nextCursor:
        rows.length === query.limit && last
          ? encodeCursor({ receivedAt: last.receivedAt, id: last.id })
          : null,
    };
  }

  /** Агент удалён — его история тоже. */
  async forget(agentId: string): Promise<void> {
    await this._events.deleteByAgent(agentId);
  }

  /** Уборка по сроку хранения. */
  async prune(now = Date.now()): Promise<{ events: number }> {
    const events = await this._events.deleteReceivedBefore(
      now - agentConfig.eventsRetentionDays * DAY_MS,
    );

    return { events };
  }
}
