import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "./events";

/** Комната списка API-ключей: право `apikey:view`. */
export const API_KEYS_ROOM = "api-keys";

/** Выпуск и отзыв ключей — в комнату списка ключей (без секрета). */
@Injectable()
export class ApiKeyListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(ApiKeyService) private readonly _keys: ApiKeyService,
  ) {}

  register(): void {
    this._eventBus.on(ApiKeyCreatedEvent, ({ apiKeyId }) =>
      this._send(apiKeyId),
    );
    this._eventBus.on(ApiKeyRevokedEvent, ({ apiKeyId }) =>
      this._send(apiKeyId),
    );
  }

  private async _send(id: string): Promise<void> {
    try {
      this._emitter.toRoom(
        API_KEYS_ROOM,
        "apikey:updated",
        await this._keys.get(id),
      );
    } catch (err) {
      logger.warn({ err, apiKeyId: id }, "[ApiKey] apikey:updated not sent");
    }
  }
}
