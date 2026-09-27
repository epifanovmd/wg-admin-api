/**
 * Символ для multi-inject всех слушателей событий EventBus → Socket/Push.
 * Каждый модуль, реагирующий на доменные события, регистрирует
 * свои слушатели через этот символ в @Module({ providers: [...] }).
 *
 * @example
 * // dialog.module.ts
 * @Module({
 *   providers: [
 *     { provide: SOCKET_EVENT_LISTENER, useClass: DialogSocketEventHandler },
 *     { provide: SOCKET_EVENT_LISTENER, useClass: DialogRoomManager },
 *   ],
 * })
 * export class DialogModule {}
 *
 * // socket.bootstrap.ts
 * @multiInject(SOCKET_EVENT_LISTENER)
 * private readonly eventListeners: ISocketEventListener[]
 */
export const SOCKET_EVENT_LISTENER = Symbol("SocketEventListener");

export interface ISocketEventListener {
  /** Подписывается на события EventBus. Вызывается один раз при старте. */
  register(): void;
}
