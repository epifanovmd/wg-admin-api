import type { WgNodeDto } from "../dto";

/** Нода создана. */
export class WgNodeCreatedEvent {
  constructor(public readonly node: WgNodeDto) {}
}

/**
 * Нода изменена (поля или статус/состояние агента). `previousOwnerId` —
 * прежний владелец, если он сменился (назначение и снятие), иначе `null`.
 */
export class WgNodeUpdatedEvent {
  constructor(
    public readonly node: WgNodeDto,
    public readonly previousOwnerId: string | null = null,
  ) {}
}

/**
 * Сменился publicHost ноды: у связанных с ней релеев и целей меняются
 * адреса туннелей и пробросов — их конфигурации нужно пересобрать.
 */
export class WgNodeHostChangedEvent {
  constructor(public readonly nodeId: string) {}
}

/**
 * Нода удалена; владелец и создатель — кому она была своей; агент ноды
 * (его отзывают) и кто удалил.
 */
export class WgNodeDeletedEvent {
  constructor(
    public readonly nodeId: string,
    public readonly ownerId: string | null = null,
    public readonly createdById: string | null = null,
    public readonly agentId: string | null = null,
    public readonly actorId: string | null = null,
  ) {}
}

/** Статус ноды изменился (online/offline/error/provisioning). */
export class WgNodeStatusChangedEvent {
  constructor(public readonly node: WgNodeDto) {}
}

/**
 * Агент отвязан от ноды (отозван или удалён): фактическое состояние,
 * которое он сообщал (статусы интерфейсов), больше неизвестно.
 */
export class WgNodeAgentUnboundEvent {
  constructor(public readonly nodeId: string) {}
}
