import { TokenProvider } from "../../core/decorators/module.decorator";
import {
  ISocketEventListener,
  SOCKET_EVENT_LISTENER,
} from "./socket-event-listener.interface";
import { ISocketHandler, SOCKET_HANDLER } from "./socket-handler.interface";

type Constructor<T = any> = new (...args: any[]) => T;

/**
 * Хелпер для регистрации Socket-хендлера (входящие события) в @Module.
 *
 * @example
 * @Module({
 *   providers: [asSocketHandler(DialogSocketHandler)],
 * })
 */
export const asSocketHandler = (
  cls: Constructor<ISocketHandler>,
): TokenProvider<ISocketHandler> => ({
  provide: SOCKET_HANDLER,
  useClass: cls,
});

/**
 * Хелпер для регистрации EventBus → Socket/Push слушателя в @Module.
 *
 * @example
 * @Module({
 *   providers: [asSocketListener(DialogSocketEventHandler)],
 * })
 */
export const asSocketListener = (
  cls: Constructor<ISocketEventListener>,
): TokenProvider<ISocketEventListener> => ({
  provide: SOCKET_EVENT_LISTENER,
  useClass: cls,
});
