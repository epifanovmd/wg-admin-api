import type { IWgSocksLive, WgSocksServiceDto } from "../dto";

/** Прокси создан или изменён (в том числе пользователи и сертификаты). */
export class WgSocksUpdatedEvent {
  constructor(public readonly service: WgSocksServiceDto) {}
}

/** Прокси удалён. */
export class WgSocksDeletedEvent {
  constructor(public readonly serviceId: string) {}
}

/** Соединения и трафик прокси по отчёту агента изменились. */
export class WgSocksStatsEvent {
  constructor(
    public readonly serviceId: string,
    public readonly live: IWgSocksLive,
  ) {}
}
