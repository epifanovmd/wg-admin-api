import type { WgInterfaceDto } from "../dto";

/** Интерфейс создан. */
export class WgInterfaceCreatedEvent {
  constructor(public readonly iface: WgInterfaceDto) {}
}

/** Интерфейс изменён (конфигурация или фактический статус). */
export class WgInterfaceUpdatedEvent {
  constructor(
    public readonly iface: WgInterfaceDto,
    /** Точка до изменения, если интерфейс перешёл на другую. */
    public readonly previousEndpointId: string | null = null,
  ) {}
}

/** Интерфейс удалён. */
export class WgInterfaceDeletedEvent {
  constructor(
    public readonly ifaceId: string,
    /** Ноды всех копий: основная и реплики. */
    public readonly nodeIds: string[],
    public readonly endpointId: string | null = null,
  ) {}
}
