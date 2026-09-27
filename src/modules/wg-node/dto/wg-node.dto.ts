import { BaseDto } from "../../../core";
import type { WgNode } from "../wg-node.entity";
import type { EWgNodeStatus, IWgNodeOsInfo } from "../wg-node.types";

export class WgNodeDto extends BaseDto {
  id: string;
  name: string;
  description: string | null;
  publicHost: string | null;
  status: EWgNodeStatus;
  /** Есть ли выпущенный ключ агента. */
  hasAgentKey: boolean;
  configVersion: number;
  appliedVersion: number;
  /** Конфигурация на ноде актуальна. */
  inSync: boolean;
  applyError: string | null;
  agentVersion: string | null;
  wgVersion: string | null;
  /** sha256 бинаря агента; сравнивается с `release` для обновления. */
  agentCodeHash: string | null;
  osInfo: IWgNodeOsInfo | null;
  /** IP, с которого агент обращается к бэкенду. */
  agentRemoteIp: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgNode) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.description = entity.description;
    this.publicHost = entity.publicHost;
    this.status = entity.status;
    this.hasAgentKey = entity.agentKeyId !== null;
    this.configVersion = entity.configVersion;
    this.appliedVersion = entity.appliedVersion;
    this.inSync = entity.appliedVersion >= entity.configVersion;
    this.applyError = entity.applyError;
    this.agentVersion = entity.agentVersion;
    this.wgVersion = entity.wgVersion;
    this.agentCodeHash = entity.agentCodeHash;
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

/** Ответ создания ноды: ключ агента возвращается только один раз. */
export interface ICreatedWgNodeDto {
  node: WgNodeDto;
  /** Секрет ключа агента — сохранить сразу, повторно не выдаётся. */
  agentKey: string;
  /** Команда ручной установки агента на VPS с этим ключом. */
  installCommand: string;
}

/** Ответ ротации ключа агента. */
export interface IWgAgentKeyDto {
  agentKey: string;
  /** Команда ручной установки агента на VPS с этим ключом. */
  installCommand: string;
}
