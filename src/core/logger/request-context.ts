import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  requestId: string;
}

/**
 * Контекст запроса, доступный из любого места вызова без прокидывания
 * параметров: логгер добавляет `requestId` ко всем записям внутри запроса.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined =>
  requestContext.getStore()?.requestId;
