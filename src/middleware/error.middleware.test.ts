import "reflect-metadata";

import { ValidateError } from "@tsoa/runtime";
import { expect } from "chai";
import sinon from "sinon";
import { QueryFailedError } from "typeorm";

import {
  defineErrors,
  ForbiddenException,
  HttpException,
  ValidationException,
} from "../core/http";
import * as loggerModule from "../core/logger/logger.service";
import { errorMiddleware, ErrorResponseBody } from "./error.middleware";

const createCtx = () =>
  ({
    status: 200,
    body: null,
    state: { requestId: "test-req" },
    path: "/api/test",
    method: "POST",
  }) as any;

describe("errorMiddleware", () => {
  let loggerStub: sinon.SinonStub;

  beforeEach(() => {
    loggerStub = sinon.stub(loggerModule.logger, "error");
  });

  afterEach(() => {
    sinon.restore();
  });

  // ── Pass-through ─────────────────────────────────────────────────

  it("no error passes through", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().resolves());

    expect(ctx.status).to.equal(200);
    expect(ctx.body).to.be.null;
  });

  // ── ValidateError (tsoa) ─────────────────────────────────────────

  it("ValidateError (tsoa) → 400 VALIDATION_ERROR, поля — в details", async () => {
    const ctx = createCtx();
    const fields = {
      email: { message: "email is required", value: undefined },
      password: { message: "min 6 chars", value: "abc" },
    };

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new ValidateError(fields, "")),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(400);
    expect(body.status).to.equal(400);
    expect(body.code).to.equal("VALIDATION_ERROR");
    expect(body.details).to.deep.equal({
      email: "email is required",
      password: "min 6 chars",
    });
  });

  it("ValidateError does not log (it's a client error)", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().rejects(new ValidateError({}, "")));

    expect(loggerStub.called).to.be.false;
  });

  // ── HttpException ────────────────────────────────────────────────

  it("HttpException → status, message, reason as details", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon
        .stub()
        .rejects(new HttpException("Not Found", 404, { id: "missing" })),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(404);
    expect(body.status).to.equal(404);
    expect(body.message).to.equal("Not Found");
    expect(body.details).to.deep.equal({ id: "missing" });
  });

  it("HttpException without reason → details undefined", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new HttpException("Gone", 410)),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(body.details).to.be.undefined;
  });

  it("HttpException with Error reason → details is inner message", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon
        .stub()
        .rejects(new HttpException("Fail", 400, new Error("inner cause"))),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(body.details).to.equal("inner cause");
  });

  it("HttpException with string reason → details is the string", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new HttpException("Bad", 400, "field X invalid")),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(body.details).to.equal("field X invalid");
  });

  it("код по умолчанию — по статусу, а не имя класса", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().rejects(new ForbiddenException()));
    const body = ctx.body as ErrorResponseBody;

    expect(body.code).to.equal("FORBIDDEN");
  });

  it("доменный код из defineErrors попадает в ответ", async () => {
    const UserError = defineErrors("USER", {
      EMAIL_TAKEN: { status: 409, message: "Email уже используется" },
    });
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(UserError.EMAIL_TAKEN({ field: "email" })),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(409);
    expect(body.code).to.equal("USER_EMAIL_TAKEN");
    expect(body.message).to.equal("Email уже используется");
    expect(body.details).to.deep.equal({ field: "email" });
  });

  it("ValidationException (Zod) → 400 VALIDATION_ERROR", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon
        .stub()
        .rejects(new ValidationException({ email: "Неверный email" })),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(400);
    expect(body.code).to.equal("VALIDATION_ERROR");
    expect(body.details).to.deep.equal({ email: "Неверный email" });
  });

  it("в ответе есть requestId для поддержки", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().rejects(new ForbiddenException()));

    expect((ctx.body as ErrorResponseBody).requestId).to.equal("test-req");
  });

  it("HttpException 4xx does not log", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new HttpException("X", 400)),
    );

    expect(loggerStub.called).to.be.false;
  });

  it("HttpException 5xx logs", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new HttpException("X", 500)),
    );

    expect(loggerStub.calledOnce).to.be.true;
  });

  // ── Generic errors ───────────────────────────────────────────────

  it("Error with statusCode uses it", async () => {
    const ctx = createCtx();
    const err = new Error("Bad Request") as any;

    err.statusCode = 400;

    await errorMiddleware(ctx, sinon.stub().rejects(err));
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(400);
    expect(body.message).to.equal("Bad Request");
  });

  it("Error with status uses it", async () => {
    const ctx = createCtx();
    const err = new Error("Forbidden") as any;

    err.status = 403;

    await errorMiddleware(ctx, sinon.stub().rejects(err));

    expect(ctx.status).to.equal(403);
  });

  it("Error with fields → details contains fields", async () => {
    const ctx = createCtx();
    const err = new Error("Bad input") as any;

    err.statusCode = 400;
    err.fields = { name: { message: "required" } };

    await errorMiddleware(ctx, sinon.stub().rejects(err));
    const body = ctx.body as ErrorResponseBody;

    expect(body.details).to.deep.equal({ name: { message: "required" } });
  });

  it("Error with errors array → details contains errors", async () => {
    const ctx = createCtx();
    const err = new Error("Zod fail") as any;

    err.statusCode = 400;
    err.errors = [{ path: "email", message: "invalid" }];

    await errorMiddleware(ctx, sinon.stub().rejects(err));
    const body = ctx.body as ErrorResponseBody;

    expect(body.details).to.deep.equal([{ path: "email", message: "invalid" }]);
  });

  it("Error with code → code preserved", async () => {
    const ctx = createCtx();
    const err = new Error("Rate limit") as any;

    err.statusCode = 429;
    err.code = "RATE_LIMITED";

    await errorMiddleware(ctx, sinon.stub().rejects(err));
    const body = ctx.body as ErrorResponseBody;

    expect(body.code).to.equal("RATE_LIMITED");
  });

  // ── 5xx safety ───────────────────────────────────────────────────

  it("5xx hides original message", async () => {
    const ctx = createCtx();

    await errorMiddleware(
      ctx,
      sinon.stub().rejects(new Error("DB password leaked")),
    );
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(500);
    expect(body.message).to.equal("Внутренняя ошибка сервера");
    expect(body.details).to.be.undefined;
    expect(body.code).to.equal("INTERNAL_ERROR");
  });

  it("5xx logs with request context", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().rejects(new Error("crash")));

    expect(loggerStub.calledOnce).to.be.true;
    const logArgs = loggerStub.firstCall.args[0];

    expect(logArgs).to.have.property("requestId", "test-req");
    expect(logArgs).to.have.property("path", "/api/test");
    expect(logArgs).to.have.property("method", "POST");
  });

  it("4xx does NOT log", async () => {
    const ctx = createCtx();
    const err = new Error("Not found") as any;

    err.statusCode = 404;

    await errorMiddleware(ctx, sinon.stub().rejects(err));

    expect(loggerStub.called).to.be.false;
  });

  it("unknown non-Error throw → 500", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, sinon.stub().rejects("string throw"));
    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(500);
    expect(body.message).to.equal("Внутренняя ошибка сервера");
  });

  // ── PostgreSQL ───────────────────────────────────────────────────

  it("невалидный формат значения в запросе к БД (22P02, «me» вместо uuid) → 400, а не 500", async () => {
    const ctx = createCtx();

    await errorMiddleware(ctx, async () => {
      throw new QueryFailedError(
        "SELECT ... WHERE id = $1",
        ["me"],
        Object.assign(new Error('invalid input syntax for type uuid: "me"'), {
          code: "22P02",
        }),
      );
    });

    const body = ctx.body as ErrorResponseBody;

    expect(ctx.status).to.equal(400);
    expect(body.code).to.equal("INVALID_PARAMETER");
    expect(body.message).to.not.include("SELECT");
    expect(loggerStub.called).to.equal(false);
  });
});
