import { createHash, timingSafeEqual } from "crypto";
import { inject } from "inversify";
import { DataSource } from "typeorm";

import { generateOtp } from "../../common";
import { EventBus, Injectable, isUniqueViolation } from "../../core";
import { MailerService } from "../mailer";
import { EmailChangeRequest } from "./email-change-request.entity";
import { EmailChangeRequestRepository } from "./email-change-request.repository";
import {
  EmailChangedEvent,
  EmailChangeRequestedEvent,
  EmailVerifiedEvent,
} from "./events";
import { User } from "./user.entity";
import { UserError } from "./user.errors";
import { UserRepository } from "./user.repository";

/** Срок действия кода смены email. */
export const EMAIL_CHANGE_TTL_MINUTES = 15;

/** Неверных вводов кода до аннулирования запроса. */
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;

/** Минимальный интервал между запросами смены email. */
export const EMAIL_CHANGE_RESEND_COOLDOWN_MS = 60_000;

/** Хеш кода с солью из id пользователя: одинаковые коды разных пользователей различаются. */
const hashCode = (userId: string, code: string): string =>
  createHash("sha256").update(`${userId}:${code}`).digest("hex");

const codeMatches = (userId: string, code: string, hash: string): boolean => {
  const actual = Buffer.from(hashCode(userId, code), "hex");
  const expected = Buffer.from(hash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/**
 * Смена email самим пользователем в два шага: запрос (код — на новый адрес,
 * уведомление — на старый) и подтверждение кодом. Занятость адреса
 * проверяется на обоих шагах.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @inject(UserRepository) private _userRepository: UserRepository,
    @inject(EmailChangeRequestRepository)
    private _requestRepository: EmailChangeRequestRepository,
    @inject(MailerService) private _mailerService: MailerService,
    @inject(DataSource) private _dataSource: DataSource,
    @inject(EventBus) private _eventBus: EventBus,
  ) {}

  /**
   * Запросить смену email. Прежний запрос заменяется; повторно — не чаще
   * раза в минуту. Письма ставятся в очередь в той же транзакции, что и
   * запрос: без записи писем нет, без писем записи нет.
   * Возвращает `false`, если адрес совпадает с текущим (менять нечего).
   */
  async request(userId: string, rawEmail: string): Promise<boolean> {
    const newEmail = rawEmail.trim().toLowerCase();
    const user = await this._userRepository.findById(userId, {
      profile: true,
    });

    if (!user) throw UserError.NOT_FOUND();

    if (newEmail === user.email) return false;

    const previous = await this._requestRepository.findByUserId(userId);

    if (
      previous &&
      Date.now() - previous.createdAt.getTime() <
        EMAIL_CHANGE_RESEND_COOLDOWN_MS
    ) {
      throw UserError.EMAIL_CHANGE_TOO_FREQUENT();
    }

    if (await this._userRepository.findConflicting(userId, newEmail)) {
      throw UserError.EMAIL_TAKEN();
    }

    const code = generateOtp();
    const locale = user.profile?.locale ?? null;

    try {
      await this._dataSource.transaction(async manager => {
        const repo = manager.getRepository(EmailChangeRequest);

        await repo.delete({ userId });
        await repo.save(
          repo.create({
            userId,
            newEmail,
            codeHash: hashCode(userId, code),
            attempts: 0,
            expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000),
          }),
        );

        await this._mailerService.send(
          "email-change-code",
          newEmail,
          { code, newEmail, expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES },
          { locale, manager },
        );

        if (user.email) {
          await this._mailerService.send(
            "email-change-notice",
            user.email,
            { newEmail },
            { locale, manager },
          );
        }
      });
    } catch (err) {
      // Параллельный запрос того же пользователя успел раньше.
      if (isUniqueViolation(err)) throw UserError.EMAIL_CHANGE_TOO_FREQUENT();

      throw err;
    }

    this._eventBus.emit(new EmailChangeRequestedEvent(userId, newEmail));

    return true;
  }

  /**
   * Подтвердить смену кодом: email меняется, `emailVerified = true`.
   * Неверный ввод расходует попытку; истёкший, исчерпанный или ставший
   * занятым адрес аннулирует запрос.
   */
  async confirm(userId: string, code: string): Promise<void> {
    const request = await this._requestRepository.findByUserId(userId);

    if (!request) throw UserError.EMAIL_CHANGE_NOT_FOUND();

    if (request.expiresAt.getTime() <= Date.now()) {
      await this._requestRepository.delete({ id: request.id });
      throw UserError.EMAIL_CHANGE_EXPIRED();
    }

    if (request.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await this._requestRepository.delete({ id: request.id });
      throw UserError.EMAIL_CHANGE_ATTEMPTS_EXCEEDED();
    }

    if (!codeMatches(userId, code, request.codeHash)) {
      await this._rejectCode(request);
    }

    const user = await this._userRepository.findById(userId);

    if (!user) throw UserError.NOT_FOUND();

    if (await this._userRepository.findConflicting(userId, request.newEmail)) {
      await this._requestRepository.delete({ id: request.id });
      throw UserError.EMAIL_TAKEN();
    }

    try {
      await this._dataSource.transaction(async manager => {
        // Удаление по id — из двух параллельных подтверждений пройдёт одно.
        const consumed = await manager
          .getRepository(EmailChangeRequest)
          .delete({ id: request.id });

        if (!consumed.affected) throw UserError.EMAIL_CHANGE_NOT_FOUND();

        await manager
          .getRepository(User)
          .update(userId, { email: request.newEmail, emailVerified: true });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        await this._requestRepository.delete({ id: request.id });
        throw UserError.EMAIL_TAKEN();
      }

      throw err;
    }

    this._eventBus.emit(
      new EmailChangedEvent(userId, user.email, request.newEmail),
    );
    this._eventBus.emit(new EmailVerifiedEvent(userId));
  }

  /** Засчитать неверный код; последняя попытка аннулирует запрос. */
  private async _rejectCode(request: EmailChangeRequest): Promise<never> {
    const attempts = await this._requestRepository.incrementAttempts(
      request.id,
      EMAIL_CHANGE_MAX_ATTEMPTS,
    );

    if (attempts === null || attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await this._requestRepository.delete({ id: request.id });
      throw UserError.EMAIL_CHANGE_ATTEMPTS_EXCEEDED();
    }

    throw UserError.EMAIL_CHANGE_INVALID_CODE({
      attemptsLeft: EMAIL_CHANGE_MAX_ATTEMPTS - attempts,
    });
  }
}
