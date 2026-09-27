import { Client } from "pg";
import { DataSource, EntityManager } from "typeorm";

import { config, nodeEnv } from "../../config";
import { logger } from "../logger";

/** Повторная попытка LISTEN после обрыва. */
const RECONNECT_MS = 30_000;

type TSignalHandler = (payload: string) => void;

/**
 * Сигналы между процессами через Postgres LISTEN/NOTIFY: одно соединение на
 * экземпляр слушает заданные каналы. NOTIFY транзакционный: отправленный
 * через `manager` (или триггером) доходит только после коммита. Без LISTEN
 * (PgBouncer в transaction mode, обрыв) подписчики работают опросом —
 * `isListening` и `onStatus` для этого. Модуль наследует класс со своим
 * набором каналов и регистрирует наследника в DI.
 */
export class PgSignals<TChannel extends string> {
  private readonly _handlers = new Map<TChannel, Set<TSignalHandler>>();
  private readonly _statusHandlers = new Set<(listening: boolean) => void>();
  private _client: Client | null = null;
  private _reconnectTimer: NodeJS.Timeout | null = null;
  private _started = false;

  constructor(
    private readonly _dataSource: DataSource,
    private readonly _channels: readonly TChannel[],
    /** Имя для логов и application_name соединения. */
    private readonly _name: string,
  ) {}

  get isListening(): boolean {
    return this._client !== null;
  }

  async start(): Promise<void> {
    if (this._started) return;

    this._started = true;
    await this.listen();
  }

  async stop(): Promise<void> {
    this._started = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;

    const client = this._client;

    this._client = null;
    await client?.end().catch(() => undefined);
  }

  /** Подписаться на канал; вернуть функцию отписки. */
  on(channel: TChannel, handler: TSignalHandler): () => void {
    const handlers = this._handlers.get(channel) ?? new Set<TSignalHandler>();

    handlers.add(handler);
    this._handlers.set(channel, handlers);

    return () => handlers.delete(handler);
  }

  /** Смена состояния LISTEN: `false` — подписчикам пора опрашивать БД. */
  onStatus(handler: (listening: boolean) => void): () => void {
    this._statusHandlers.add(handler);

    return () => this._statusHandlers.delete(handler);
  }

  /** Отправить сигнал; с `manager` — в его транзакции (дойдёт после коммита). */
  async notify(
    channel: TChannel,
    payload: string,
    manager?: EntityManager,
  ): Promise<void> {
    await (manager ?? this._dataSource).query("SELECT pg_notify($1, $2)", [
      channel,
      payload,
    ]);
  }

  /** Отдельное соединение под LISTEN; фабрика подменяется в тестах. */
  protected createClient(): Client {
    const pg = config.database.postgres;

    return new Client({
      host: pg.host,
      port: pg.port,
      database: pg.database,
      user: pg.username,
      password: pg.password,
      ssl: pg.ssl
        ? {
            ca: pg.sslCa || undefined,
            rejectUnauthorized: pg.sslRejectUnauthorized,
          }
        : false,
      connectionTimeoutMillis: pg.connectionTimeoutMs,
      application_name: `${config.app.name}:${nodeEnv}:${this._name}`,
      keepAlive: true,
    });
  }

  private dispatch(channel: string, payload: string): void {
    for (const handler of this._handlers.get(channel as TChannel) ?? []) {
      try {
        handler(payload);
      } catch (err) {
        logger.warn(
          { err, channel },
          `[${this._name}] Обработчик сигнала упал`,
        );
      }
    }
  }

  private setStatus(listening: boolean): void {
    for (const handler of this._statusHandlers) handler(listening);
  }

  private async listen(): Promise<void> {
    const client = this.createClient();

    client.on("notification", message => {
      if (message.payload) this.dispatch(message.channel, message.payload);
    });
    client.on("error", err => this.onDisconnect(client, err));
    client.on("end", () => this.onDisconnect(client));

    try {
      await client.connect();
      for (const channel of this._channels) {
        await client.query(`LISTEN ${channel}`);
      }
      this._client = client;
      this.setStatus(true);
    } catch (err) {
      logger.warn(
        { err },
        `[${this._name}] LISTEN недоступен — работа опросом`,
      );
      await client.end().catch(() => undefined);
      this.onDisconnect(client);
    }
  }

  private onDisconnect(client: Client, err?: unknown): void {
    if (this._client === client) {
      this._client = null;
      if (err) {
        logger.warn({ err }, `[${this._name}] Соединение LISTEN оборвалось`);
      }
    }
    if (!this._started || this._client) return;

    this.setStatus(false);

    if (!this._reconnectTimer) {
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (this._started && !this._client) void this.listen();
      }, RECONNECT_MS);
      this._reconnectTimer.unref();
    }
  }
}
