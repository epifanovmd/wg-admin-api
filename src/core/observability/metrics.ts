import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

import { config } from "../../config";

/**
 * Реестр метрик приложения (не глобальный реестр prom-client): в тестах и
 * при повторной загрузке модулей метрики не конфликтуют с чужими.
 */
export const metricsRegistry = new Registry();

metricsRegistry.setDefaultLabels({
  service: config.app.name,
  role: config.app.role,
});

collectDefaultMetrics({ register: metricsRegistry });

/** Длительность HTTP-запросов; `route` — шаблон маршрута, а не URL. */
export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Длительность HTTP-запросов, секунд",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

/** Ответы с ошибкой по машинному коду (`USER_NOT_FOUND`, `VALIDATION_ERROR`). */
export const httpErrorsTotal = new Counter({
  name: "http_errors_total",
  help: "Ответы с ошибкой по коду",
  labelNames: ["code", "status"] as const,
  registers: [metricsRegistry],
});

/** Открытые сокет-подключения этого процесса. */
export const socketConnections = new Gauge({
  name: "socket_connections",
  help: "Открытые Socket.IO-подключения процесса",
  registers: [metricsRegistry],
});

export const jobsTotal = new Counter({
  name: "jobs_total",
  help: "Завершённые задачи по очереди и исходу",
  labelNames: ["queue", "outcome"] as const,
  registers: [metricsRegistry],
});

export const jobDuration = new Histogram({
  name: "job_duration_seconds",
  help: "Длительность выполнения задач, секунд",
  labelNames: ["queue", "outcome"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300, 900],
  registers: [metricsRegistry],
});

export const jobsActive = new Gauge({
  name: "jobs_active",
  help: "Задачи, выполняемые процессом сейчас",
  labelNames: ["queue"] as const,
  registers: [metricsRegistry],
});

/** Сокет с событием `disconnect` — достаточно для учёта подключения. */
export interface DisconnectableSocket {
  once(event: "disconnect", listener: (...args: any[]) => void): unknown;
}

/**
 * Учесть сокет в `socket_connections`: +1 сейчас, −1 на `disconnect`.
 * Вызывать один раз в обработчике `connection`.
 */
export const trackSocketConnection = (socket: DisconnectableSocket): void => {
  socketConnections.inc();
  socket.once("disconnect", () => socketConnections.dec());
};
