import { randomBytes } from "crypto";
import { inject } from "inversify";

import { hashToken, tokenHashMatches } from "../auth";
import { isUniqueViolation } from "../db";
import { Injectable } from "../decorators";
import { IPaginatedDto, normalizePagination, toPage } from "../dto";
import { logger } from "../logger";
import { agentConfig } from "./agent.config";
import { AgentError } from "./agent.errors";
import { AgentEnrollmentToken } from "./agent-enrollment-token.entity";
import { AgentEnrollmentTokenRepository } from "./agent-enrollment-token.repository";

/** Тело создания токена регистрации. */
export interface ICreateAgentEnrollmentToken {
  name: string;
  labels?: Record<string, string>;
  maxUses?: number | null;
  expiresAt?: Date | null;
}

/** Попыток подобрать свободный префикс (коллизия 48 бит — редкость). */
const PREFIX_ATTEMPTS = 3;

/**
 * Чем зарегистрирован агент: созданный токен (id, кто создал, его метки)
 * или общий токен окружения (`tokenId: null`, без меток).
 */
export interface IAgentEnrollmentSource {
  tokenId: string | null;
  createdBy: string | null;
  /** Метки токена (только выданные сервером, не присланные агентом). */
  labels: Record<string, string>;
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
 * Регистрация агентов: токены в БД (создание, список, отзыв) и проверка токена при
 * `POST /agent/v1/enroll`: общий токен из окружения или выпущенный — с учётом срока, отзыва
 * и лимита использований.
 */
@Injectable()
export class AgentEnrollmentService {
  constructor(
    @inject(AgentEnrollmentTokenRepository)
    private readonly _tokens: AgentEnrollmentTokenRepository,
  ) {}

  /** Создать токен; полный токен (`<prefix>.<secret>`) возвращается только здесь. */
  async createToken(
    createdBy: string | null,
    body: ICreateAgentEnrollmentToken,
  ): Promise<{ token: string; enrollmentToken: AgentEnrollmentToken }> {
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

        return { enrollmentToken: token, token: `${prefix}.${secret}` };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= PREFIX_ATTEMPTS) throw err;
      }
    }
  }

  async listTokens(
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<AgentEnrollmentToken>> {
    const page = normalizePagination(offset, limit);
    const [tokens, total] = await this._tokens.findPage(
      page.offset,
      page.limit,
    );

    return toPage(tokens, total, page);
  }

  /** Отозвать: новые регистрации по токену невозможны, агенты остаются. */
  async revokeToken(id: string): Promise<void> {
    if (!(await this._tokens.findById(id))) {
      throw AgentError.ENROLLMENT_TOKEN_NOT_FOUND();
    }

    await this._tokens.revoke(id, new Date());
  }

  /** Проверить токен регистрации: годится — источник (метки токена), иначе `null`. */
  async enroll(
    token: string,
    info: { name: string },
  ): Promise<IAgentEnrollmentSource | null> {
    const bootstrap = agentConfig.bootstrapToken;

    if (bootstrap && sameSecret(token, bootstrap)) {
      return { tokenId: null, createdBy: null, labels: {} };
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

    return {
      tokenId: stored.id,
      createdBy: stored.createdBy,
      labels: { ...stored.labels },
    };
  }
}
