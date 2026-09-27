import type { WgForwardDto } from "../dto";

/** Проброс создан, изменён или сменил активный маршрут. */
export class WgForwardUpdatedEvent {
  constructor(public readonly forward: WgForwardDto) {}
}

/** Проброс удалён. */
export class WgForwardDeletedEvent {
  constructor(public readonly forwardId: string) {}
}
