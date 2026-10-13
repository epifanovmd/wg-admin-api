import type { TokenProvider } from "../decorators";

/**
 * Токен multi-inject обработчиков запросов воркеров к серверу: модули
 * регистрируют `asWorkerRequestHandler(Cls)`. Транспорт (агенты) находит
 * обработчик по типу запроса и отвечает воркеру его результатом.
 */
export const WORKER_REQUEST_HANDLER = Symbol("WorkerRequestHandler");

/** Узел, с которого пришёл запрос. */
export interface WorkerRequestAgent {
  id: string;
  name: string;
  labels: Record<string, string>;
}

/** Запрос воркера, как его видит обработчик. */
export interface WorkerRequestInfo<T = unknown> {
  /** Id запроса (для журнала). */
  id: string;
  agent: WorkerRequestAgent;
  /** Имя воркера на узле. */
  worker: string;
  /** Тип запроса — `requests[].type` манифеста воркера. */
  type: string;
  /** Данные запроса; проверены по `requests[].schema`, если она есть. */
  data: T | undefined;
  /** Срок ответа истёк или связь с узлом оборвалась. */
  signal: AbortSignal;
}

/**
 * Обработчик запроса воркера одного типа. Результат (JSON) воркер получает
 * как `data` ответа; отказ — `WorkerRequestError` (код и текст уходят
 * воркеру). Проверку «кому можно» делает обработчик: по `agent` (метки,
 * узел) и `worker`; `workers` — короткий способ ограничить воркеры.
 */
export interface IWorkerRequestHandler<TData = unknown, TResult = unknown> {
  /** Тип запроса — `requests[].type` манифеста воркера: `report.lookup`. */
  readonly type: string;
  /** Только от этих воркеров; без — от любого, объявившего тип. */
  readonly workers?: readonly string[];
  handle(request: WorkerRequestInfo<TData>): Promise<TResult>;
}

/**
 * Отказ в запросе воркера: код (`^[A-Z][A-Z0-9_]*$`) и текст уходят
 * воркеру как есть (агент отвечает ему `422`). Повторять запрос с теми же
 * данными бессмысленно.
 */
export class WorkerRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerRequestError";
  }
}

export const asWorkerRequestHandler = (
  handler: new (...args: any[]) => IWorkerRequestHandler<any, any>,
): TokenProvider<IWorkerRequestHandler> => ({
  provide: WORKER_REQUEST_HANDLER,
  useClass: handler,
});
