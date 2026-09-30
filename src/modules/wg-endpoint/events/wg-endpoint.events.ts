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
  route: string;
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

/**
 * Изменились интерфейсы точки (подключение, копии, порт, имя) — только для
 * UI: «куда ведёт» в списке точек. Доменных реакций нет.
 */
export class WgEndpointInterfacesChangedEvent {
  constructor(public readonly endpoint: WgEndpointDto) {}
}

/**
 * Точка подключения сохранена (любое поле) — для подписчиков UI.
 * `previousOwnerId` — прежний владелец, если он сменился.
 */
export class WgEndpointChangedEvent {
  constructor(
    public readonly endpoint: WgEndpointDto,
    public readonly previousOwnerId: string | null = null,
  ) {}
}

/** Точка подключения удалена (использовавших интерфейсов не было). */
export class WgEndpointDeletedEvent {
  constructor(
    public readonly endpointId: string,
    /** Владелец и создатель — кому точка была своей. */
    public readonly ownerId: string | null = null,
    public readonly createdById: string | null = null,
  ) {}
}
