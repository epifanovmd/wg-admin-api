import { expect } from "chai";
import sinon from "sinon";

import {
  ErrorReporter,
  flushErrors,
  reportError,
  reportProcessError,
  setErrorReporter,
} from "./error-reporter";

const makeCtx = (status: number) =>
  ({
    status,
    method: "POST",
    path: "/api/v1/items/1",
    _matchedRoute: "/api/v1/items/:id",
    state: { requestId: "req-1", user: { userId: "user-1" } },
    request: {},
  }) as any;

describe("error-reporter", () => {
  let reporter: { capture: sinon.SinonStub; flush: sinon.SinonStub };

  beforeEach(() => {
    reporter = { capture: sinon.stub(), flush: sinon.stub().resolves() };
    setErrorReporter(reporter as ErrorReporter);
  });

  afterEach(() => setErrorReporter(undefined));

  it("5xx уходит в трекер с контекстом запроса", () => {
    const err = new Error("boom");

    reportError(err, makeCtx(500));

    expect(reporter.capture.calledOnce).to.be.true;
    expect(reporter.capture.firstCall.args[0]).to.equal(err);
    expect(reporter.capture.firstCall.args[1]).to.include({
      source: "http",
      status: 500,
      route: "/api/v1/items/:id",
      requestId: "req-1",
      userId: "user-1",
    });
  });

  it("4xx не отправляется", () => {
    reportError(new Error("nope"), makeCtx(404));
    reportError(new Error("nope"), makeCtx(500), 400);

    expect(reporter.capture.called).to.be.false;
  });

  it("ошибки процесса отправляются с источником", () => {
    reportProcessError("reason", "unhandledRejection");

    expect(reporter.capture.firstCall.args[1]).to.deep.equal({
      source: "unhandledRejection",
    });
  });

  it("без трекера — без ошибок, flush сразу", async () => {
    setErrorReporter(undefined);

    reportError(new Error("boom"), makeCtx(500));
    reportProcessError(new Error("boom"), "uncaughtException");
    await flushErrors();

    expect(reporter.capture.called).to.be.false;
  });

  it("flush не пробрасывает ошибку трекера", async () => {
    reporter.flush.rejects(new Error("network"));

    await flushErrors(10);

    expect(reporter.flush.calledOnceWith(10)).to.be.true;
  });
});
