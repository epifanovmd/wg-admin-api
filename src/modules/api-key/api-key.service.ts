import { randomBytes } from "crypto";
import { inject } from "inversify";

import {
  EventBus,
  hashToken,
  Injectable,
  IPaginatedDto,
  isUniqueViolation,
  logger,
  normalizePagination,
  tokenHashMatches,
  toPage,
} from "../../core";
import { ApiKey } from "./api-key.entity";
import { ApiKeyError } from "./api-key.errors";
import { ApiKeyRepository } from "./api-key.repository";
import {
  API_KEY_MAX_LENGTH,
  API_KEY_PREFIX_BYTES,
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_BYTES,
  API_KEY_TOUCH_INTERVAL_MS,
} from "./api-key.types";
import { ApiKeyDto, ICreateApiKeyBody, ICreatedApiKeyDto } from "./dto";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "./events";

/** Попыток подобрать свободный префикс (коллизия 48 бит — редкость). */
const PREFIX_ATTEMPTS = 3;

const generateKey = (): { prefix: string; secret: string } => ({
  prefix: randomBytes(API_KEY_PREFIX_BYTES).toString("base64url"),
  secret: randomBytes(API_KEY_SECRET_BYTES).toString("base64url"),
});

/** `<prefix>.<secret>` → части; `null` — формат не наш. */
export const parseApiKey = (
  raw: string,
): { prefix: string; secret: string } | null => {
  if (raw.length > API_KEY_MAX_LENGTH) return null;

  const dot = raw.indexOf(".");

  if (dot !== API_KEY_PREFIX_LENGTH) return null;

  const secret = raw.slice(dot + 1);

  return secret ? { prefix: raw.slice(0, dot), secret } : null;
};

@Injectable()
export class ApiKeyService {
  constructor(
    @inject(ApiKeyRepository) private readonly _keys: ApiKeyRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Создать ключ; секрет возвращается только здесь. */
  async create(
    ownerId: string,
    body: ICreateApiKeyBody,
  ): Promise<ICreatedApiKeyDto> {
    for (let attempt = 1; ; attempt += 1) {
      const { prefix, secret } = generateKey();

      try {
        const apiKey = await this._keys.createAndSave({
          name: body.name,
          prefix,
          hash: hashToken(secret),
          scopes: [...new Set(body.scopes)],
          ownerId,
          expiresAt: body.expiresAt ?? null,
          lastUsedAt: null,
          revokedAt: null,
        });

        this._eventBus.emit(
          new ApiKeyCreatedEvent(
            apiKey.id,
            ownerId,
            apiKey.name,
            apiKey.scopes,
          ),
        );

        return {
          apiKey: ApiKeyDto.fromEntity(apiKey),
          key: `${prefix}.${secret}`,
        };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= PREFIX_ATTEMPTS) throw err;
      }
    }
  }

  async list(
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<ApiKeyDto>> {
    const page = normalizePagination(offset, limit);
    const [keys, total] = await this._keys.findPage(page.offset, page.limit);

    return toPage(keys.map(ApiKeyDto.fromEntity), total, page);
  }

  /** Ключ по ID (без секрета). */
  async get(id: string): Promise<ApiKeyDto> {
    const apiKey = await this._keys.findById(id);

    if (!apiKey) throw ApiKeyError.NOT_FOUND();

    return ApiKeyDto.fromEntity(apiKey);
  }

  /** Отозвать ключ; повторный отзыв ничего не меняет. */
  async revoke(id: string, revokedBy?: string): Promise<void> {
    const apiKey = await this._keys.findById(id);

    if (!apiKey) throw ApiKeyError.NOT_FOUND();
    if (apiKey.revokedAt) return;

    await this._keys.update({ id }, { revokedAt: new Date() });
    this._eventBus.emit(new ApiKeyRevokedEvent(id, revokedBy));
  }

  /** Действующий ключ по предъявленной строке или 401. */
  async verify(raw: string): Promise<ApiKey> {
    const parsed = parseApiKey(raw);

    if (!parsed) throw ApiKeyError.INVALID();

    const apiKey = await this._keys.findByPrefix(parsed.prefix);
    const now = new Date();

    if (
      !apiKey ||
      !tokenHashMatches(parsed.secret, apiKey.hash) ||
      apiKey.revokedAt ||
      (apiKey.expiresAt && apiKey.expiresAt <= now)
    ) {
      throw ApiKeyError.INVALID();
    }

    this.touch(apiKey, now);

    return apiKey;
  }

  /** `lastUsedAt` — не чаще раза в минуту и не задерживая запрос. */
  private touch(apiKey: ApiKey, now: Date): void {
    const before = new Date(now.getTime() - API_KEY_TOUCH_INTERVAL_MS);

    if (apiKey.lastUsedAt && apiKey.lastUsedAt > before) return;

    this._keys
      .touch(apiKey.id, now, before)
      .catch(err =>
        logger.warn(
          { err, apiKeyId: apiKey.id },
          "[ApiKey] lastUsedAt не обновлён",
        ),
      );
  }
}
