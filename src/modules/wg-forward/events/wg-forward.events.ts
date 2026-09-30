import type { WgForwardDto } from "../dto";

/**
 * Проброс создан, изменён или сменил активный маршрут. `previousOwnerId` —
 * прежний владелец, если он сменился (назначение и снятие).
 */
export class WgForwardUpdatedEvent {
  constructor(
    public readonly forward: WgForwardDto,
    public readonly previousOwnerId: string | null = null,
  ) {}
}

/** Проброс удалён; владелец и создатель — кому он был своим. */
export class WgForwardDeletedEvent {
  constructor(
    public readonly forwardId: string,
    public readonly ownerId: string | null = null,
    public readonly createdById: string | null = null,
  ) {}
}
