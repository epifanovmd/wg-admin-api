import { BaseDto } from "../../../core";
import { userDisplayName } from "../../user/user-name";
import type { WgNode } from "../wg-node.entity";
import type { EWgNodeStatus, IWgNodeOsInfo } from "../wg-node.types";

export class WgNodeDto extends BaseDto {
  id: string;
  /** Назначенный владелец ноды. */
  ownerId: string | null;
  /** Отображаемое имя владельца. */
  ownerName: string | null;
  /** Создатель ноды. */
  createdById: string | null;
  /** Отображаемое имя создателя. */
  createdByName: string | null;
  name: string;
  description: string | null;
  publicHost: string | null;
  status: EWgNodeStatus;
  /** Пояснение к статусу: что не так с агентом или воркерами. */
  statusMessage: string | null;
  /** Агент ноды (`/api/v1/agents/{agentId}`); нет — агент не установлен. */
  agentId: string | null;
  configVersion: number;
  appliedVersion: number;
  /** Конфигурация на ноде актуальна. */
  inSync: boolean;
  applyError: string | null;
  agentVersion: string | null;
  wgVersion: string | null;
  osInfo: IWgNodeOsInfo | null;
  /** IP, с которого агент подключился к бэкенду. */
  agentRemoteIp: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgNode) {
    super(entity);

    this.id = entity.id;
    this.ownerId = entity.ownerId;
    this.ownerName = userDisplayName(entity.owner);
    this.createdById = entity.createdById;
    this.createdByName = userDisplayName(entity.createdBy);
    this.name = entity.name;
    this.description = entity.description;
    this.publicHost = entity.publicHost;
    this.status = entity.status;
    this.statusMessage = entity.statusMessage;
    this.agentId = entity.agentId;
    this.configVersion = entity.configVersion;
    this.appliedVersion = entity.appliedVersion;
    this.inSync = entity.appliedVersion >= entity.configVersion;
    this.applyError = entity.applyError;
    this.agentVersion = entity.agentVersion;
    this.wgVersion = entity.wgVersion;
    this.osInfo = entity.osInfo;
    this.agentRemoteIp = entity.agentRemoteIp;
    this.lastSeenAt = entity.lastSeenAt;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: WgNode) {
    return new WgNodeDto(entity);
  }
}

/** Краткая запись для выпадающих списков. */
export class WgNodeOptionDto extends BaseDto {
  id: string;
  name: string;
  status: EWgNodeStatus;

  constructor(entity: WgNode) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.status = entity.status;
  }

  static fromEntity(entity: WgNode) {
    return new WgNodeOptionDto(entity);
  }
}

/** Команда установки агента на ноду и токен регистрации в ней. */
export interface IWgNodeInstallCommandDto {
  /** `curl … | sudo sh -s -- --instance … --token … --worker wg …` — выполнить на VPS. */
  command: string;
  /** Токен регистрации (одноразовый, с меткой ноды) — виден только здесь. */
  token: string;
  tokenId: string;
  expiresAt: Date;
}

/** Ответ создания ноды: команда установки агента (токен — только здесь). */
export interface ICreatedWgNodeDto {
  node: WgNodeDto;
  install: IWgNodeInstallCommandDto;
}

/** Журнал агента или воркера ноды. */
export interface IWgNodeLogsDto {
  /** Строки журнала текстом: `время уровень источник: сообщение`. */
  content: string;
  entries: Array<{
    at: number;
    level: string;
    source: string;
    msg: string;
    attrs?: Record<string, unknown>;
  }>;
}
