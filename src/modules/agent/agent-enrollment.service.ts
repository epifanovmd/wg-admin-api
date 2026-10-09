import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";
import { inject } from "inversify";

import {
  hashToken,
  Injectable,
  IPaginatedDto,
  isUniqueViolation,
  logger,
  normalizePagination,
  tokenHashMatches,
  toPage,
} from "../../core";
import { agentConfig } from "./agent.config";
import { AgentError } from "./agent.errors";
import { AgentEnrollmentTokenRepository } from "./agent-enrollment-token.repository";
import {
  AgentEnrollmentTokenDto,
  ICreateAgentEnrollmentTokenBody,
  ICreatedAgentEnrollmentTokenDto,
} from "./dto";

/** Попыток подобрать свободный префикс (коллизия 48 бит — редкость). */
const PREFIX_ATTEMPTS = 3;

/** Что получает агент при регистрации: метки, которые узел не перепишет. */
export interface IAgentEnrollmentGrant {
  labels?: Record<string, string>;
}

/**
 * Чем зарегистрирован агент: выпущенный токен (id, кто выпустил, его метки)
 * или общий токен окружения (`tokenId: null`, без меток).
 */
export interface IAgentEnrollmentSource {
  tokenId: string | null;
  createdBy: string | null;
  /** Метки токена (только выданные сервером, не присланные агентом). */
  labels: Record<string, string>;
}

/** Контекст одного HTTP-запроса агента: источник регистрации из хука. */
interface IEnrollmentContext {
  source?: IAgentEnrollmentSource;
}

/** `<prefix>.<secret>` → части; `null` — не похоже на токен. */
export const parseEnrollmentToken = (
  raw: string,
): { prefix: string; secret: string } | null => {
  const dot = raw.indexOf(".");

  if (dot <= 0 || dot === raw.length - 1) return null;

  return { prefix: raw.slice(0, dot), secret: raw.slice(dot + 1) };
};

/** Строки равны; сравнение за постоянное время (по хешам равной длины). */
const sameSecret = (actual: string, expected: string): boolean =>
  tokenHashMatches(actual, hashToken(expected));

/**
 * Регистрация агентов: токены в БД (выпуск, список, отзыв) и проверка
 * токена для `Agents` (хук `enroll`): общий токен из окружения или
 * выпущенный — с учётом срока, отзыва и лимита использований.
 */
@Injectable()
export class AgentEnrollmentService {
  private readonly _context = new AsyncLocalStorage<IEnrollmentContext>();

  constructor(
    @inject(AgentEnrollmentTokenRepository)
    private readonly _tokens: AgentEnrollmentTokenRepository,
  ) {}

  /** Выпустить токен; полный токен возвращается только здесь. */
  async createToken(
    createdBy: string,
    body: ICreateAgentEnrollmentTokenBody,
  ): Promise<ICreatedAgentEnrollmentTokenDto> {
    for (let attempt = 1; ; attempt += 1) {
      const prefix = randomBytes(6).toString("base64url");
      const secret = randomBytes(32).toString("base64url");

      try {
        const token = await this._tokens.createAndSave({
          name: body.name,
          prefix,
          hash: hashToken(secret),
          labels: body.labels ?? {},
          maxUses: body.maxUses ?? null,
          uses: 0,
          expiresAt: body.expiresAt ?? null,
          revokedAt: null,
          createdBy,
        });

        return {
          enrollmentToken: AgentEnrollmentTokenDto.fromEntity(token),
          token: `${prefix}.${secret}`,
        };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= PREFIX_ATTEMPTS) throw err;
      }
    }
  }

  async listTokens(
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<AgentEnrollmentTokenDto>> {
    const page = normalizePagination(offset, limit);
    const [tokens, total] = await this._tokens.findPage(
      page.offset,
      page.limit,
    );

    return toPage(tokens.map(AgentEnrollmentTokenDto.fromEntity), total, page);
  }

  /** Отозвать: новые регистрации по токену невозможны, агенты остаются. */
  async revokeToken(id: string): Promise<void> {
    if (!(await this._tokens.findById(id))) {
      throw AgentError.ENROLLMENT_TOKEN_NOT_FOUND();
    }

    await this._tokens.revoke(id, new Date());
  }

  /**
   * Выполнить обработку запроса агента в своём контексте: хук `enroll`
   * запоминает в нём источник регистрации, `takeSource` забирает его, когда
   * SDK сообщает о новом агенте (в той же цепочке вызовов запроса).
   */
  withContext<T>(fn: () => Promise<T>): Promise<T> {
    return this._context.run({}, fn);
  }

  /** Источник регистрации текущего запроса (один раз); вне регистрации — `null`. */
  takeSource(): IAgentEnrollmentSource | null {
    const context = this._context.getStore();
    const source = context?.source ?? null;

    if (context) context.source = undefined;

    return source;
  }

  /**
   * Хук регистрации `Agents`: токен годится — метки агента, иначе `null`
   * (SDK ответит 401 и учтёт неудачу по адресу клиента).
   */
  async enroll(
    token: string,
    info: { name: string },
  ): Promise<IAgentEnrollmentGrant | null> {
    const bootstrap = agentConfig.bootstrapToken;

    if (bootstrap && sameSecret(token, bootstrap)) {
      this.remember({ tokenId: null, createdBy: null, labels: {} });

      return {};
    }

    const parsed = parseEnrollmentToken(token);
    const stored = parsed
      ? await this._tokens.findByPrefix(parsed.prefix)
      : null;

    if (
      !parsed ||
      !stored ||
      !tokenHashMatches(parsed.secret, stored.hash) ||
      !(await this._tokens.consume(stored.id, new Date()))
    ) {
      return null;
    }

    logger.info(
      { tokenId: stored.id, agent: info.name },
      "[Agent] Регистрация по токену",
    );
    this.remember({
      tokenId: stored.id,
      createdBy: stored.createdBy,
      labels: { ...stored.labels },
    });

    return { labels: stored.labels };
  }

  private remember(source: IAgentEnrollmentSource): void {
    const context = this._context.getStore();

    if (context) context.source = source;
  }
}
