import { BaseDto } from "../../../core/dto/BaseDto";
import { ApiKey } from "../api-key.entity";

export class ApiKeyDto extends BaseDto {
  id: string;
  name: string;
  /** Открытая часть ключа: по ней ключ узнают в списке. */
  prefix: string;
  scopes: string[];
  ownerId: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;

  constructor(entity: ApiKey) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.prefix = entity.prefix;
    this.scopes = entity.scopes;
    this.ownerId = entity.ownerId;
    this.lastUsedAt = entity.lastUsedAt;
    this.expiresAt = entity.expiresAt;
    this.revokedAt = entity.revokedAt;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: ApiKey): ApiKeyDto {
    return new ApiKeyDto(entity);
  }
}

/** Созданный ключ: `key` показывается один раз и больше не восстановим. */
export interface ICreatedApiKeyDto {
  apiKey: ApiKeyDto;
  /** Полный ключ `<prefix>.<secret>` — передаётся в `X-Api-Key`. */
  key: string;
}

export interface ICreateApiKeyBody {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /** Разрешения: `worker:demo.echo`, `worker:*`. */
  scopes: string[];
  /** Срок действия; без него ключ бессрочный. */
  expiresAt?: Date;
}
