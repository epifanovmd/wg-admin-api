import type { WgEndpointDto } from "../dto";

/** Точка подключения создана. */
export class WgEndpointCreatedEvent {
  constructor(public readonly endpoint: WgEndpointDto) {}
}

/** Поля предыдущего состояния, влияющие на конфигурацию нод. */
export interface IWgEndpointConfigSnapshot {
  host: string;
  mode: string;
  relayNodeId: string | null;
  forwardMode: string;
}

/**
 * Точка подключения изменена. Модуль интерфейсов пересинхронизирует
 * релей-линки и поднимает версии конфигурации затронутых нод.
 */
export class WgEndpointUpdatedEvent {
  constructor(
    public readonly endpoint: WgEndpointDto,
    public readonly previous: IWgEndpointConfigSnapshot,
  ) {}
}

/** Точка подключения сохранена (любое поле) — для подписчиков UI. */
export class WgEndpointChangedEvent {
  constructor(public readonly endpoint: WgEndpointDto) {}
}

/** Точка подключения удалена (использовавших интерфейсов не было). */
export class WgEndpointDeletedEvent {
  constructor(public readonly endpointId: string) {}
}
