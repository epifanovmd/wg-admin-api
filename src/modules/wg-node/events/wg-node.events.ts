import type { WgNodeDto } from "../dto";

/** Нода создана. */
export class WgNodeCreatedEvent {
  constructor(public readonly node: WgNodeDto) {}
}

/** Нода изменена (поля или статус/состояние агента). */
export class WgNodeUpdatedEvent {
  constructor(public readonly node: WgNodeDto) {}
}

/**
 * Сменился publicHost ноды: у связанных с ней релеев и целей меняются
 * адреса туннелей и пробросов — их конфигурации нужно пересобрать.
 */
export class WgNodeHostChangedEvent {
  constructor(public readonly nodeId: string) {}
}

/** Нода удалена. */
export class WgNodeDeletedEvent {
  constructor(public readonly nodeId: string) {}
}

/** Статус ноды изменился (online/offline/error/provisioning). */
export class WgNodeStatusChangedEvent {
  constructor(public readonly node: WgNodeDto) {}
}
