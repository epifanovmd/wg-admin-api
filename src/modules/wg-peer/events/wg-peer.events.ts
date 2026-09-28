import type { WgPeerDto } from "../dto";

/** Пир создан. */
export class WgPeerCreatedEvent {
  constructor(public readonly peer: WgPeerDto) {}
}

/** Пир изменён (конфигурация, держатель, включение/выключение). */
export class WgPeerUpdatedEvent {
  constructor(
    public readonly peer: WgPeerDto,
    /** Прежний держатель, если держатель сменился. */
    public readonly previousUserId: string | null = null,
  ) {}
}

/** Пир удалён. */
export class WgPeerDeletedEvent {
  constructor(
    public readonly peerId: string,
    public readonly userId: string | null,
  ) {}
}
