import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { config } from "../../config";
import { JobError } from "../../core";
import { createMockJobQueue } from "../../test/helpers";
import { MailRenderer } from "./mail-renderer";
import { MailSendJob } from "./mail-send.job";
import { MailError } from "./mailer.errors";
import { MailerService } from "./mailer.service";
import { MAIL_SEND_QUEUE, resolveMailLocale } from "./mailer.types";

describe("MailerService", () => {
  let service: MailerService;
  let jobs: ReturnType<typeof createMockJobQueue>;
  let transport: { sendMail: sinon.SinonStub };
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    jobs = createMockJobQueue();
    service = new MailerService(jobs as any, new MailRenderer());
    transport = {
      sendMail: sinon.stub().resolves({ messageId: "msg-123" }),
    };
    service.transport = transport as any;
    service.configured = true;
  });

  afterEach(() => sandbox.restore());

  describe("send — постановка в очередь", () => {
    it("ставит задачу mail.send с шаблоном, адресатом, данными и локалью", async () => {
      await service.send(
        "otp-code",
        "user@example.com",
        { code: "123456" },
        { locale: "en-US" },
      );

      expect(jobs.enqueue.calledOnce).to.be.true;

      const [queue, data] = jobs.enqueue.firstCall.args;

      expect(queue).to.equal(MAIL_SEND_QUEUE);
      expect(data).to.deep.equal({
        template: "otp-code",
        to: "user@example.com",
        data: { code: "123456" },
        locale: "en",
      });
      expect(transport.sendMail.called).to.be.false;
    });

    it("без локали — ru", async () => {
      await service.send("otp-code", "a@b.c", { code: "1" });

      expect(jobs.enqueue.firstCall.args[1].locale).to.equal("ru");
    });

    it("manager вызывающего передаётся в enqueue (outbox)", async () => {
      const manager = {} as any;

      await service.send("otp-code", "a@b.c", { code: "1" }, { manager });

      expect(jobs.enqueue.firstCall.args[2].manager).to.equal(manager);
    });

    it("SMTP не настроен в production — MAIL_NOT_CONFIGURED (503), задача не ставится", async () => {
      service.configured = false;
      service.production = true;

      try {
        await service.send("otp-code", "a@b.c", { code: "1" });
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(MailError.codes.NOT_CONFIGURED);
        expect(err.status).to.equal(503);
      }

      expect(jobs.enqueue.called).to.be.false;
    });

    it("SMTP не настроен вне production — задача ставится", async () => {
      service.configured = false;

      await service.send("otp-code", "a@b.c", { code: "1" });

      expect(jobs.enqueue.calledOnce).to.be.true;
    });

    it("sendResetPasswordMail — ссылка из конфига с токеном", async () => {
      await service.sendResetPasswordMail("u@x.y", "reset-token-123");

      const data = jobs.enqueue.firstCall.args[1];

      expect(data.template).to.equal("reset-password");
      expect(data.data.resetLink).to.equal(
        config.auth.resetPassword.webUrl.replace(
          "{{token}}",
          "reset-token-123",
        ),
      );
    });

    it("sendCodeMail — шаблон otp-code", async () => {
      await service.sendCodeMail("u@x.y", "654321", { locale: "en" });

      const data = jobs.enqueue.firstCall.args[1];

      expect(data.template).to.equal("otp-code");
      expect(data.data).to.deep.equal({ code: "654321" });
      expect(data.locale).to.equal("en");
    });
  });

  describe("deliver — синхронная отправка в обработчике", () => {
    const job = {
      template: "otp-code" as const,
      to: "user@example.com",
      data: { code: "123456" },
      locale: "ru" as const,
    };

    it("отправляет HTML и текстовую версию с темой из шаблона", async () => {
      await service.deliver(job);

      const options = transport.sendMail.firstCall.args[0];

      expect(options.to).to.equal("user@example.com");
      expect(options.from).to.equal(
        config.email.smtp.from || config.email.smtp.user,
      );
      expect(options.subject).to.equal("Код подтверждения");
      expect(options.html).to.include("123456");
      expect(options.text).to.include("123456");
    });

    it("SMTP не настроен вне production — письмо только в лог", async () => {
      service.configured = false;

      await service.deliver(job);

      expect(transport.sendMail.called).to.be.false;
    });

    it("SMTP не настроен в production — JobError без повторов", async () => {
      service.configured = false;
      service.production = true;

      try {
        await service.deliver(job);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err).to.be.instanceOf(JobError);
        expect(err.code).to.equal(MailError.codes.NOT_CONFIGURED);
        expect(err.retryable).to.be.false;
      }
    });

    it("временный сбой SMTP — JobError с повтором", async () => {
      transport.sendMail.rejects(new Error("ECONNRESET"));

      try {
        await service.deliver(job);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err).to.be.instanceOf(JobError);
        expect(err.code).to.equal(MailError.codes.UNAVAILABLE);
        expect(err.retryable).to.be.true;
      }
    });

    it("постоянный отказ SMTP (5xx) — JobError без повторов", async () => {
      transport.sendMail.rejects(
        Object.assign(new Error("mailbox unavailable"), { responseCode: 550 }),
      );

      try {
        await service.deliver(job);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.retryable).to.be.false;
      }
    });

    it("неизвестный шаблон — JobError без повторов", async () => {
      try {
        await service.deliver({ ...job, template: "nope" as any });
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err).to.be.instanceOf(JobError);
        expect(err.code).to.equal(MailError.codes.TEMPLATE_NOT_FOUND);
        expect(err.retryable).to.be.false;
      }
    });

    it("неизвестная локаль в задаче — ru", async () => {
      await service.deliver({ ...job, locale: "de" as any });

      expect(transport.sendMail.firstCall.args[0].subject).to.equal(
        "Код подтверждения",
      );
    });
  });

  describe("MailSendJob", () => {
    it("очередь mail.send, 5 повторов с backoff; handle → deliver", async () => {
      const deliver = sandbox.stub(service, "deliver").resolves();
      const handler = new MailSendJob(service);

      expect(handler.definition.queue).to.equal(MAIL_SEND_QUEUE);
      expect(handler.definition.retryLimit).to.equal(5);
      expect(handler.definition.retryBackoff).to.be.true;

      const data = {
        template: "otp-code" as const,
        to: "a@b.c",
        data: { code: "1" },
        locale: "ru" as const,
      };

      await handler.handle({ data } as any);

      expect(deliver.calledOnceWith(data)).to.be.true;
    });
  });

  describe("resolveMailLocale", () => {
    it("нормализует и откатывается к ru", () => {
      expect(resolveMailLocale("en")).to.equal("en");
      expect(resolveMailLocale("EN_gb")).to.equal("en");
      expect(resolveMailLocale("ru-RU")).to.equal("ru");
      expect(resolveMailLocale("de")).to.equal("ru");
      expect(resolveMailLocale(null)).to.equal("ru");
      expect(resolveMailLocale(undefined)).to.equal("ru");
      expect(resolveMailLocale("")).to.equal("ru");
    });
  });
});
