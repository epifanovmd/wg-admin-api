import { BaseDto } from "../../../core";
import type {
  WgSocksClient,
  WgSocksService,
  WgSocksUser,
} from "../wg-socks.entity";

/** Live-показатели прокси по отчёту агента. */
export interface IWgSocksLive {
  connections: number;
  rxBytes: number;
  txBytes: number;
  ts: string;
}

export class WgSocksUserDto extends BaseDto {
  id: string;
  username: string;
  enabled: boolean;
  createdAt: Date;

  constructor(entity: WgSocksUser) {
    super(entity);
    this.id = entity.id;
    this.username = entity.username;
    this.enabled = entity.enabled;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: WgSocksUser) {
    return new WgSocksUserDto(entity);
  }
}

export class WgSocksClientDto extends BaseDto {
  id: string;
  name: string;
  fingerprint: string;
  revoked: boolean;
  createdAt: Date;

  constructor(entity: WgSocksClient) {
    super(entity);
    this.id = entity.id;
    this.name = entity.name;
    this.fingerprint = entity.fingerprint;
    this.revoked = entity.revoked;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: WgSocksClient) {
    return new WgSocksClientDto(entity);
  }
}

export class WgSocksServiceDto extends BaseDto {
  id: string;
  /** Назначенный владелец прокси. */
  ownerId: string | null;
  /** Создатель прокси. */
  createdById: string | null;
  name: string;
  description: string | null;
  nodeId: string;
  nodeName: string | null;
  /** publicHost ноды. */
  nodeHost: string | null;
  listenPort: number;
  clientHost: string | null;
  clientPort: number | null;
  serverName: string;
  enabled: boolean;
  users: WgSocksUserDto[];
  clients: WgSocksClientDto[];
  live: IWgSocksLive | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgSocksService, live: IWgSocksLive | null = null) {
    super(entity);
    this.id = entity.id;
    this.ownerId = entity.ownerId;
    this.createdById = entity.createdById;
    this.name = entity.name;
    this.description = entity.description;
    this.nodeId = entity.nodeId;
    this.nodeName = entity.node?.name ?? null;
    this.nodeHost = entity.node?.publicHost ?? null;
    this.listenPort = entity.listenPort;
    this.clientHost = entity.clientHost;
    this.clientPort = entity.clientPort;
    this.serverName = entity.serverName;
    this.enabled = entity.enabled;
    this.users = (entity.users ?? [])
      .slice()
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(WgSocksUserDto.fromEntity);
    this.clients = (entity.clients ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(WgSocksClientDto.fromEntity);
    this.live = live;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: WgSocksService, live: IWgSocksLive | null = null) {
    return new WgSocksServiceDto(entity, live);
  }
}

/** Пароль пользователя — только для manage (ссылка для Telegram). */
export interface IWgSocksUserSecretDto {
  username: string;
  password: string;
}
