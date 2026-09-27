import crypto from "crypto";
import { inject } from "inversify";
import { Not } from "typeorm";

import {
  EventBus,
  hashToken,
  IIssuedTokens,
  Injectable,
  IPaginatedDto,
  IRefreshContext,
  ITokensDto,
  logger,
  normalizePagination,
  TokenService,
  TokenSubject,
  toPage,
} from "../../core";
import { SessionTerminatedEvent } from "./events";
import { SessionDto } from "./session.dto";
import { Session } from "./session.entity";
import { SessionError } from "./session.errors";
import { SessionRepository } from "./session.repository";
import { IDeviceInfo, TSessionEndReason } from "./session.types";

/** Сколько активных сессий держит пользователь; старейшие сверх — завершаются. */
export const MAX_ACTIVE_SESSIONS = 10;

/** Ответ клиенту — без служебного срока refresh-токена. */
const toTokensDto = ({
  accessToken,
  refreshToken,
  expiresIn,
  sessionId,
}: IIssuedTokens): ITokensDto => ({
  accessToken,
  refreshToken,
  expiresIn,
  sessionId,
});

@Injectable()
export class SessionService {
  constructor(
    @inject(SessionRepository) private _sessionRepo: SessionRepository,
    @inject(TokenService) private _tokenService: TokenService,
    @inject(EventBus) private _eventBus: EventBus,
  ) {}

  /**
   * Создать сессию и выдать токены. В БД — только хеш refresh-токена и его срок.
   * Сессии сверх лимита (самые старые) завершаются.
   */
  async createAuthenticatedSession(
    subject: TokenSubject,
    deviceInfo: IDeviceInfo = {},
  ): Promise<{ sessionId: string; tokens: ITokensDto; session: Session }> {
    const sessionId = crypto.randomUUID();
    const tokens = await this._tokenService.issue(subject, sessionId);

    const session = await this._sessionRepo.createAndSave({
      id: sessionId,
      userId: subject.id,
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: tokens.refreshExpiresAt,
      deviceName: deviceInfo.deviceName ?? null,
      deviceType: deviceInfo.deviceType ?? null,
      ip: deviceInfo.ip ?? null,
      userAgent: deviceInfo.userAgent ?? null,
    });

    await this._evictBeyondLimit(subject.id);

    return { sessionId, tokens: toTokensDto(tokens), session };
  }

  /**
   * Проверить предъявленный refresh-токен против сессии.
   * Токен, который уже ротирован (хеш не совпадает), — признак кражи:
   * сессия завершается целиком.
   */
  async validateRefresh(
    decoded: IRefreshContext,
    refreshToken: string,
  ): Promise<Session> {
    const session = await this._sessionRepo.findById(decoded.sessionId);

    if (
      !session ||
      session.id !== decoded.sessionId ||
      session.userId !== decoded.userId
    ) {
      throw SessionError.INVALID();
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this._terminate([session.id], session.userId, "expired");
      throw SessionError.EXPIRED();
    }

    if (session.refreshTokenHash !== hashToken(refreshToken)) {
      await this._terminate([session.id], session.userId, "refresh-reuse");
      throw SessionError.REFRESH_REUSED();
    }

    return session;
  }

  /**
   * Атомарно заменить refresh-токен сессии новым. Если параллельный запрос
   * успел ротировать тот же токен — это повторное использование: сессия
   * завершается, запрос получает 401.
   */
  async rotateRefreshToken(
    session: Session,
    oldRefreshToken: string,
    tokens: IIssuedTokens,
  ): Promise<ITokensDto> {
    const rotated = await this._sessionRepo.rotateRefreshToken(
      session.id,
      hashToken(oldRefreshToken),
      hashToken(tokens.refreshToken),
      tokens.refreshExpiresAt,
    );

    if (!rotated) {
      await this._terminate([session.id], session.userId, "refresh-reuse");
      throw SessionError.REFRESH_REUSED();
    }

    return toTokensDto(tokens);
  }

  /** Действующие сессии пользователя, страницей. */
  async getSessions(
    userId: string,
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<SessionDto>> {
    const page = normalizePagination(offset, limit);
    const [sessions, total] = await this._sessionRepo.findActiveByUserId(
      userId,
      page,
    );

    return toPage(sessions.map(SessionDto.fromEntity), total, page);
  }

  /** Завершить свою сессию. */
  async terminateSession(
    sessionId: string,
    userId: string,
    reason: TSessionEndReason = "terminated",
  ) {
    const session = await this._sessionRepo.findById(sessionId);

    if (!session) {
      throw SessionError.NOT_FOUND();
    }

    if (session.userId !== userId) {
      throw SessionError.FORBIDDEN();
    }

    await this._terminate([sessionId], userId, reason);
  }

  /** Завершить все сессии, кроме текущей. */
  async terminateAllOther(
    userId: string,
    currentSessionId: string,
    reason: TSessionEndReason = "others-terminated",
  ) {
    await this.terminateAllByUser(userId, currentSessionId, reason);
  }

  /** Завершить все сессии пользователя, кроме `exceptSessionId` (если задана). */
  async terminateAllByUser(
    userId: string,
    exceptSessionId?: string,
    reason: TSessionEndReason = "terminated",
  ) {
    const sessions = await this._sessionRepo.find({
      where: exceptSessionId
        ? { userId, id: Not(exceptSessionId) }
        : { userId },
      select: { id: true },
    });

    await this._terminate(
      sessions.map(session => session.id),
      userId,
      reason,
    );
  }

  /** Удалить просроченные сессии (фоновая очистка). */
  async cleanupExpired(): Promise<number> {
    return this._sessionRepo.deleteExpired();
  }

  private async _evictBeyondLimit(userId: string) {
    const ids = await this._sessionRepo.findIdsBeyondLimit(
      userId,
      MAX_ACTIVE_SESSIONS,
    );

    await this._terminate(ids, userId, "evicted");
  }

  /**
   * Удалить сессии и сразу отозвать их access-токены: следующий запрос с
   * ними получит 401, не дожидаясь истечения токена.
   */
  private async _terminate(
    sessionIds: string[],
    userId: string,
    reason: TSessionEndReason,
  ) {
    if (!sessionIds.length) return;

    await this._sessionRepo.deleteByIds(sessionIds);

    try {
      await this._tokenService.revokeSessions(sessionIds);
    } catch (err) {
      logger.error({ err, userId }, "[Session] Access-token revocation failed");
    }

    for (const sessionId of sessionIds) {
      this._eventBus.emit(
        new SessionTerminatedEvent(sessionId, userId, reason),
      );
    }
  }
}
