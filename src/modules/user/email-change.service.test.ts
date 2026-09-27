import "reflect-metadata";

import { expect } from "chai";
import { createHash } from "crypto";
import sinon from "sinon";
import { QueryFailedError } from "typeorm";

import { createMockEventBus, uuid, uuid2 } from "../../test/helpers";
import {
  EMAIL_CHANGE_MAX_ATTEMPTS,
  EMAIL_CHANGE_TTL_MINUTES,
  EmailChangeService,
} from "./email-change.service";
import {
  EmailChangedEvent,
  EmailChangeRequestedEvent,
  EmailVerifiedEvent,
} from "./events";

const userId = uuid();
const hash = (code: string) =>
  createHash("sha256").update(`${userId}:${code}`).digest("hex");

const uniqueViolation = () =>
  new QueryFailedError("INSERT", [], { code: "23505" } as any);

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail("should have thrown");
  } catch (err: any) {
    expect(err.code).to.equal(code);

    return err;
  }
};

describe("EmailChangeService", () => {
  let service: EmailChangeService;
  let userRepo: { findById: sinon.SinonStub; findConflicting: sinon.SinonStub };
  let requestRepo: {
    findByUserId: sinon.SinonStub;
    incrementAttempts: sinon.SinonStub;
    delete: sinon.SinonStub;
  };
  let mailer: { send: sinon.SinonStub };
  let eventBus: ReturnType<typeof createMockEventBus>;
  let manager: any;
  let txRequestRepo: {
    delete: sinon.SinonStub;
    save: sinon.SinonStub;
    create: sinon.SinonStub;
  };
  let txUserRepo: { update: sinon.SinonStub };

  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    id: userId,
    email: "old@example.com",
    profile: { locale: "en" },
    ...overrides,
  });

  const makeRequest = (overrides: Record<string, unknown> = {}) => ({
    id: "req-1",
    userId,
    newEmail: "new@example.com",
    codeHash: hash("123456"),
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(Date.now() - 5 * 60_000),
    ...overrides,
  });

  beforeEach(() => {
    userRepo = {
      findById: sinon.stub().resolves(makeUser()),
      findConflicting: sinon.stub().resolves(null),
    };
    requestRepo = {
      findByUserId: sinon.stub().resolves(null),
      incrementAttempts: sinon.stub().resolves(1),
      delete: sinon.stub().resolves({ affected: 1 }),
    };
    mailer = { send: sinon.stub().resolves() };
    eventBus = createMockEventBus();
    txRequestRepo = {
      delete: sinon.stub().resolves({ affected: 1 }),
      save: sinon.stub().callsFake(async (e: any) => e),
      create: sinon.stub().callsFake((e: any) => e),
    };
    txUserRepo = { update: sinon.stub().resolves({ affected: 1 }) };
    manager = {
      getRepository: (entity: { name: string }) =>
        entity.name === "User" ? txUserRepo : txRequestRepo,
    };

    service = new EmailChangeService(
      userRepo as any,
      requestRepo as any,
      mailer as any,
      { transaction: sinon.stub().callsFake((cb: any) => cb(manager)) } as any,
      eventBus as any,
    );
  });

  describe("request", () => {
    it("создаёт запрос с хешем кода и ставит письма в той же транзакции", async () => {
      const changed = await service.request(userId, " New@Example.com ");

      expect(changed).to.be.true;
      expect(txRequestRepo.delete.calledOnceWith({ userId })).to.be.true;

      const saved = txRequestRepo.save.firstCall.args[0];

      expect(saved.newEmail).to.equal("new@example.com");
      expect(saved.attempts).to.equal(0);
      expect(saved.expiresAt.getTime()).to.be.closeTo(
        Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000,
        5_000,
      );

      const [codeCall, noticeCall] = mailer.send.getCalls();
      const code = codeCall.args[2].code;

      expect(code).to.match(/^\d{6}$/);
      expect(saved.codeHash).to.equal(hash(code));
      expect(saved.codeHash).to.not.include(code);

      expect(codeCall.args[0]).to.equal("email-change-code");
      expect(codeCall.args[1]).to.equal("new@example.com");
      expect(codeCall.args[2]).to.include({
        newEmail: "new@example.com",
        expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES,
      });
      expect(codeCall.args[3]).to.deep.equal({ locale: "en", manager });

      expect(noticeCall.args[0]).to.equal("email-change-notice");
      expect(noticeCall.args[1]).to.equal("old@example.com");
      expect(noticeCall.args[2]).to.deep.equal({ newEmail: "new@example.com" });
      expect(noticeCall.args[3].manager).to.equal(manager);

      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        EmailChangeRequestedEvent,
      );
    });

    it("без старого email — только письмо с кодом", async () => {
      userRepo.findById.resolves(makeUser({ email: null, profile: null }));

      await service.request(userId, "new@example.com");

      expect(mailer.send.calledOnce).to.be.true;
      expect(mailer.send.firstCall.args[3].locale).to.be.null;
    });

    it("тот же адрес — ничего не делает", async () => {
      const changed = await service.request(userId, "OLD@example.com");

      expect(changed).to.be.false;
      expect(txRequestRepo.save.called).to.be.false;
      expect(mailer.send.called).to.be.false;
    });

    it("адрес занят — USER_EMAIL_TAKEN, запрос не создаётся", async () => {
      userRepo.findConflicting.resolves({ id: uuid2() });

      await expectCode(
        service.request(userId, "taken@example.com"),
        "USER_EMAIL_TAKEN",
      );
      expect(userRepo.findConflicting.calledWith(userId, "taken@example.com"))
        .to.be.true;
      expect(txRequestRepo.save.called).to.be.false;
      expect(mailer.send.called).to.be.false;
    });

    it("повтор раньше минуты — USER_EMAIL_CHANGE_TOO_FREQUENT", async () => {
      requestRepo.findByUserId.resolves(makeRequest({ createdAt: new Date() }));

      await expectCode(
        service.request(userId, "new@example.com"),
        "USER_EMAIL_CHANGE_TOO_FREQUENT",
      );
      expect(mailer.send.called).to.be.false;
    });

    it("повтор после минуты заменяет прежний запрос", async () => {
      requestRepo.findByUserId.resolves(makeRequest());

      await service.request(userId, "other@example.com");

      expect(txRequestRepo.delete.calledOnceWith({ userId })).to.be.true;
      expect(txRequestRepo.save.firstCall.args[0].newEmail).to.equal(
        "other@example.com",
      );
    });

    it("параллельный запрос (unique violation) — USER_EMAIL_CHANGE_TOO_FREQUENT", async () => {
      txRequestRepo.save.rejects(uniqueViolation());

      await expectCode(
        service.request(userId, "new@example.com"),
        "USER_EMAIL_CHANGE_TOO_FREQUENT",
      );
      expect(eventBus.emit.called).to.be.false;
    });

    it("сбой постановки письма пробрасывается, событие не публикуется", async () => {
      mailer.send.rejects(
        Object.assign(new Error("no smtp"), { code: "MAIL_NOT_CONFIGURED" }),
      );

      await expectCode(
        service.request(userId, "new@example.com"),
        "MAIL_NOT_CONFIGURED",
      );
      expect(eventBus.emit.called).to.be.false;
    });

    it("пользователь не найден — USER_NOT_FOUND", async () => {
      userRepo.findById.resolves(null);

      await expectCode(
        service.request(userId, "new@example.com"),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("confirm", () => {
    it("верный код — email меняется и подтверждается, запрос погашен", async () => {
      requestRepo.findByUserId.resolves(makeRequest());

      await service.confirm(userId, "123456");

      expect(txRequestRepo.delete.calledOnceWith({ id: "req-1" })).to.be.true;
      expect(
        txUserRepo.update.calledOnceWith(userId, {
          email: "new@example.com",
          emailVerified: true,
        }),
      ).to.be.true;

      const [changed, verified] = eventBus.emit.getCalls().map(c => c.args[0]);

      expect(changed).to.be.instanceOf(EmailChangedEvent);
      expect(changed.oldEmail).to.equal("old@example.com");
      expect(changed.newEmail).to.equal("new@example.com");
      expect(verified).to.be.instanceOf(EmailVerifiedEvent);
    });

    it("нет запроса — USER_EMAIL_CHANGE_NOT_FOUND", async () => {
      await expectCode(
        service.confirm(userId, "123456"),
        "USER_EMAIL_CHANGE_NOT_FOUND",
      );
    });

    it("истёкший запрос удаляется — USER_EMAIL_CHANGE_EXPIRED", async () => {
      requestRepo.findByUserId.resolves(
        makeRequest({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const err = await expectCode(
        service.confirm(userId, "123456"),
        "USER_EMAIL_CHANGE_EXPIRED",
      );

      expect(err.status).to.equal(410);
      expect(requestRepo.delete.calledOnceWith({ id: "req-1" })).to.be.true;
      expect(txUserRepo.update.called).to.be.false;
    });

    it("неверный код расходует попытку и сообщает остаток", async () => {
      requestRepo.findByUserId.resolves(makeRequest());
      requestRepo.incrementAttempts.resolves(2);

      const err = await expectCode(
        service.confirm(userId, "000000"),
        "USER_EMAIL_CHANGE_INVALID_CODE",
      );

      expect(
        requestRepo.incrementAttempts.calledOnceWith(
          "req-1",
          EMAIL_CHANGE_MAX_ATTEMPTS,
        ),
      ).to.be.true;
      expect(err.reason).to.deep.equal({
        attemptsLeft: EMAIL_CHANGE_MAX_ATTEMPTS - 2,
      });
      expect(requestRepo.delete.called).to.be.false;
      expect(txUserRepo.update.called).to.be.false;
    });

    it("последняя неверная попытка аннулирует запрос", async () => {
      requestRepo.findByUserId.resolves(makeRequest());
      requestRepo.incrementAttempts.resolves(EMAIL_CHANGE_MAX_ATTEMPTS);

      await expectCode(
        service.confirm(userId, "000000"),
        "USER_EMAIL_CHANGE_ATTEMPTS_EXCEEDED",
      );
      expect(requestRepo.delete.calledOnceWith({ id: "req-1" })).to.be.true;
    });

    it("исчерпанные попытки — даже верный код не принимается", async () => {
      requestRepo.findByUserId.resolves(
        makeRequest({ attempts: EMAIL_CHANGE_MAX_ATTEMPTS }),
      );

      await expectCode(
        service.confirm(userId, "123456"),
        "USER_EMAIL_CHANGE_ATTEMPTS_EXCEEDED",
      );
      expect(txUserRepo.update.called).to.be.false;
    });

    it("адрес заняли после запроса — USER_EMAIL_TAKEN, запрос удаляется", async () => {
      requestRepo.findByUserId.resolves(makeRequest());
      userRepo.findConflicting.resolves({ id: uuid2() });

      await expectCode(service.confirm(userId, "123456"), "USER_EMAIL_TAKEN");
      expect(requestRepo.delete.calledOnceWith({ id: "req-1" })).to.be.true;
      expect(txUserRepo.update.called).to.be.false;
    });

    it("гонка за уникальный email в транзакции — USER_EMAIL_TAKEN", async () => {
      requestRepo.findByUserId.resolves(makeRequest());
      txUserRepo.update.rejects(uniqueViolation());

      await expectCode(service.confirm(userId, "123456"), "USER_EMAIL_TAKEN");
      expect(eventBus.emit.called).to.be.false;
    });

    it("параллельное подтверждение уже погасило запрос — USER_EMAIL_CHANGE_NOT_FOUND", async () => {
      requestRepo.findByUserId.resolves(makeRequest());
      txRequestRepo.delete.resolves({ affected: 0 });

      await expectCode(
        service.confirm(userId, "123456"),
        "USER_EMAIL_CHANGE_NOT_FOUND",
      );
      expect(txUserRepo.update.called).to.be.false;
      expect(eventBus.emit.called).to.be.false;
    });
  });
});
