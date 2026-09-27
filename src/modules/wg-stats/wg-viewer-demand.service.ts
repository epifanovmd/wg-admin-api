import { inject } from "inversify";

import { Injectable } from "../../core";
import { SocketEmitterService } from "../socket";
import { WgLiveStore } from "./wg-live-store.service";

/** Как часто процесс пересматривает спрос. */
const CHECK_INTERVAL_MS = 2000;
/** Отметка «есть зрители» живёт дольше интервала проверки процессов. */
const VIEWERS_TTL_SEC = 10;
const VIEWERS_KEY = "viewers";

/**
 * Спрос на живую статистику: открыта ли админка хоть у кого-то. Процесс, к
 * которому подключены веб-клиенты, продлевает общую отметку; спрос есть, если
 * клиенты есть у этого процесса или отметка свежая (другая реплика API).
 * От спроса зависят частота статистики агентов и отправка событий на каждый
 * тик.
 */
@Injectable()
export class WgViewerDemandService {
  private _checkedAt = 0;
  private _watched = false;

  constructor(
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
  ) {}

  async isWatched(): Promise<boolean> {
    const now = Date.now();

    if (now - this._checkedAt < CHECK_INTERVAL_MS) return this._watched;
    this._checkedAt = now;

    if (this._emitter.localClientsCount() > 0) {
      await this._live.setJson(VIEWERS_KEY, now, VIEWERS_TTL_SEC);
      this._watched = true;
    } else {
      this._watched = (await this._live.getJson(VIEWERS_KEY)) !== null;
    }

    return this._watched;
  }
}
