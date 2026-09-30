import type { IWgSocksLive, WgSocksServiceDto } from "../dto";

/**
 * Прокси создан или изменён (в том числе пользователи и сертификаты).
 * `previousOwnerId` — прежний владелец, если он сменился.
 */
export class WgSocksUpdatedEvent {
  constructor(
    public readonly service: WgSocksServiceDto,
    public readonly previousOwnerId: string | null = null,
  ) {}
}

/** Прокси удалён; владелец и создатель — кому он был своим. */
export class WgSocksDeletedEvent {
  constructor(
    public readonly serviceId: string,
    public readonly ownerId: string | null = null,
    public readonly createdById: string | null = null,
  ) {}
}

/** Соединения и трафик прокси по отчёту агента изменились. */
export class WgSocksStatsEvent {
  constructor(
    public readonly serviceId: string,
    public readonly live: IWgSocksLive,
    /** Владелец и создатель прокси — кому статистика идёт как «своя». */
    public readonly ownerId: string | null = null,
    public readonly createdById: string | null = null,
  ) {}
}
