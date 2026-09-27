import type { WgInterfaceDto } from "../dto";

/** Интерфейс создан. */
export class WgInterfaceCreatedEvent {
  constructor(public readonly iface: WgInterfaceDto) {}
}

/** Интерфейс изменён (конфигурация или фактический статус). */
export class WgInterfaceUpdatedEvent {
  constructor(public readonly iface: WgInterfaceDto) {}
}

/** Интерфейс удалён. */
export class WgInterfaceDeletedEvent {
  constructor(
    public readonly ifaceId: string,
    /** Ноды всех копий: основная и реплики. */
    public readonly nodeIds: string[],
  ) {}
}
