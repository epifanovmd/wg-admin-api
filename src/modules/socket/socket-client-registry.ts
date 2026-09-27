import { inject, optional } from "inversify";
import type { Redis } from "ioredis";

import { getRedis, Injectable, logger } from "../../core";
import { TSocket } from "./socket.types";

/** Токен для подмены хранилища присутствия (тесты, другой бэкенд). */
export const PRESENCE_STORE = Symbol("PresenceStore");

/** Хранилище присутствия: какие пользователи сейчас подключены. */
export interface IPresenceStore {
  add(userId: string, socketId: string): Promise<void>;
  remove(userId: string, socketId: string): Promise<void>;
  isOnline(userId: string): Promise<boolean>;
  /** Продлить срок записей локальных соединений (только для общего хранилища). */
  touch(userIds: Iterable<string>): Promise<void>;
}

/** Память одной реплики. */
export class MemoryPresenceStore implements IPresenceStore {
  private readonly _sockets = new Map<string, Set<string>>();

  async add(userId: string, socketId: string): Promise<void> {
    let set = this._sockets.get(userId);

    if (!set) {
      set = new Set();
      this._sockets.set(userId, set);
    }

    set.add(socketId);
  }

  async remove(userId: string, socketId: string): Promise<void> {
    const set = this._sockets.get(userId);

    if (!set) return;

    set.delete(socketId);
    if (set.size === 0) this._sockets.delete(userId);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (this._sockets.get(userId)?.size ?? 0) > 0;
  }

  async touch(): Promise<void> {}
}

/** Срок записи присутствия; реплики продлевают его heartbeat-ом. */
export const PRESENCE_TTL_SECONDS = 60;

/**
 * Общее присутствие для нескольких реплик: `SET presence:<userId>` из
 * идентификаторов соединений. Если реплика умерла, не сняв свои соединения,
 * её записи исчезнут вместе с ключом не позже TTL.
 */
export class RedisPresenceStore implements IPresenceStore {
  constructor(private readonly _redis: Redis) {}

  private _key(userId: string): string {
    return `presence:${userId}`;
  }

  async add(userId: string, socketId: string): Promise<void> {
    await this._redis
      .multi()
      .sadd(this._key(userId), socketId)
      .expire(this._key(userId), PRESENCE_TTL_SECONDS)
      .exec();
  }

  async remove(userId: string, socketId: string): Promise<void> {
    await this._redis.srem(this._key(userId), socketId);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this._redis.scard(this._key(userId))) > 0;
  }

  async touch(userIds: Iterable<string>): Promise<void> {
    const pipeline = this._redis.pipeline();

    for (const userId of userIds) {
      pipeline.expire(this._key(userId), PRESENCE_TTL_SECONDS);
    }

    await pipeline.exec();
  }
}

/**
 * Реестр активных соединений и присутствие пользователей.
 * Доставка сообщений идёт через комнаты Socket.IO (`user_<id>`), реестр
 * нужен только для `isOnline` (push офлайн-пользователям, presence).
 * С Redis присутствие общее для всех реплик.
 */
@Injectable()
export class SocketClientRegistry {
  private readonly _store: IPresenceStore;
  private readonly _local = new Map<string, Set<TSocket>>();
  private _heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(@optional() @inject(PRESENCE_STORE) store?: IPresenceStore) {
    const redis = getRedis();

    this._store =
      store ??
      (redis ? new RedisPresenceStore(redis) : new MemoryPresenceStore());
  }

  /** Локально подключённые пользователи этой реплики. */
  get localUserIds(): string[] {
    return [...this._local.keys()];
  }

  async register(userId: string, socket: TSocket): Promise<void> {
    let sockets = this._local.get(userId);

    if (!sockets) {
      sockets = new Set();
      this._local.set(userId, sockets);
    }

    sockets.add(socket);
    await this._store.add(userId, socket.id);
  }

  async unregister(userId: string, socket: TSocket): Promise<void> {
    const sockets = this._local.get(userId);

    sockets?.delete(socket);
    if (sockets?.size === 0) this._local.delete(userId);

    await this._store.remove(userId, socket.id);
  }

  isOnline(userId: string): Promise<boolean> {
    return this._store.isOnline(userId);
  }

  /** Из списка — те, кто сейчас онлайн. */
  async filterOnline(userIds: string[]): Promise<string[]> {
    const online = await Promise.all(userIds.map(id => this.isOnline(id)));

    return userIds.filter((_, index) => online[index]);
  }

  /** Продлевать записи локальных соединений, пока реплика жива. */
  startHeartbeat(intervalMs = (PRESENCE_TTL_SECONDS * 1000) / 3): void {
    this._heartbeat = setInterval(() => {
      this._store
        .touch(this._local.keys())
        .catch(err => logger.error({ err }, "[Presence] heartbeat failed"));
    }, intervalMs);
    this._heartbeat.unref();
  }

  /** Снять локальные соединения из общего присутствия при остановке. */
  async stop(): Promise<void> {
    clearInterval(this._heartbeat);
    this._heartbeat = undefined;

    await Promise.all(
      [...this._local].flatMap(([userId, sockets]) =>
        [...sockets].map(socket => this._store.remove(userId, socket.id)),
      ),
    );
    this._local.clear();
  }
}
