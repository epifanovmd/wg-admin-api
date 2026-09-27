import { z } from "zod";

import {
  WgAgentCommandCompleteSchema,
  WgAgentCommandOutputSchema,
  WgAgentReportSchema,
  WgAgentStatsSchema,
} from "./validation";
import type {
  IWgAgentCommandCompleteBody,
  IWgAgentDesiredState,
  IWgAgentReportBody,
  IWgAgentStatsBody,
} from "./wg-agent-protocol";

/**
 * Канал постоянной связи с агентом: WebSocket, JSON-сообщения с полем
 * `type`. Аутентификация — заголовок `X-Api-Key` при подключении. HTTP-протокол
 * (`/api/v1/wg-agent/state|stats|commands`) остаётся запасным путём.
 *
 * Порядок: агент подключается и шлёт `hello` с известной ему версией
 * конфигурации → сервер отвечает `welcome` и, если версия устарела или есть
 * команды, `state`. Дальше сервер сам присылает `state` при изменениях и
 * `rate` при смене частоты статистики; агент шлёт `stats` (сервер подтверждает
 * `ack` с номером тика), `report` и сообщения команд. Живость — WebSocket
 * ping/pong.
 */

/** Путь подключения. */
export const WG_AGENT_LINK_PATH = "/api/v1/wg-agent/link";
/** Версия протокола канала; агент передаёт её в заголовке `X-Agent-Link`. */
export const WG_AGENT_LINK_PROTOCOL = 1;
/** Предел размера сообщения агента. */
export const WG_AGENT_LINK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Сколько ждать `hello` после подключения. */
export const WG_AGENT_LINK_HELLO_TIMEOUT_MS = 10_000;

/** Коды закрытия соединения сервером. */
export enum EWgAgentLinkClose {
  /** Сервер перезапускается — агент переподключается. */
  Restart = 1012,
  /** Нарушение протокола: не прислал `hello` вовремя. */
  Protocol = 4000,
  /** Ключ отозван, истёк или сменился. */
  Unauthorized = 4401,
}

/** Сообщения агента. */
export type TWgAgentLinkIncoming =
  | { type: "hello"; knownVersion: number }
  | { type: "report"; report: IWgAgentReportBody }
  | { type: "stats"; stats: IWgAgentStatsBody }
  | { type: "command.ack"; id: string }
  | { type: "command.output"; id: string; chunk: string }
  | ({ type: "command.complete"; id: string } & IWgAgentCommandCompleteBody);

/** Сообщения сервера. */
export type TWgAgentLinkOutgoing =
  | {
      type: "welcome";
      protocol: number;
      statsIntervalMs: number;
      serverTime: number;
    }
  | { type: "state"; state: IWgAgentDesiredState }
  | { type: "rate"; statsIntervalMs: number }
  | { type: "ack"; seq: number }
  | { type: "error"; message: string };

export const WgAgentLinkIncomingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    knownVersion: z.number().int(),
  }),
  z.object({ type: z.literal("report"), report: WgAgentReportSchema }),
  z.object({ type: z.literal("stats"), stats: WgAgentStatsSchema }),
  z.object({ type: z.literal("command.ack"), id: z.uuid() }),
  z
    .object({ type: z.literal("command.output"), id: z.uuid() })
    .extend(WgAgentCommandOutputSchema.shape),
  z
    .object({ type: z.literal("command.complete"), id: z.uuid() })
    .extend(WgAgentCommandCompleteSchema.shape),
]);
