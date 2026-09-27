import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";
import { z } from "zod";

import { defineErrors, logger } from "../../core";
import { onValidated, takeSocketToken } from "./socket-validation";

const TestError = defineErrors("TEST", {
  DENIED: { status: 403, message: "Нельзя" },
});

const createSocket = () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {};

  return {
    on: (event: string, fn: (...args: unknown[]) => Promise<void>) => {
      handlers[event] = fn;
    },
    emit: sinon.stub(),
    data: { userId: "u-1" },
    fire: (event: string, ...args: unknown[]) => handlers[event](...args),
  };
};

const Schema = z.object({ id: z.string().uuid("Некорректный UUID") });
const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

describe("onValidated", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it("валидные данные → обработчик с результатом парсинга и ack ok", async () => {
    const socket = createSocket();
    const handler = sinon.stub().resolves();
    const ack = sinon.stub();

    onValidated(socket as any, "room:subscribe", Schema, handler);
    await socket.fire("room:subscribe", { id: ENTITY_ID, extra: 1 }, ack);

    expect(handler.calledOnceWith({ id: ENTITY_ID })).to.be.true;
    expect(ack.calledOnceWith({ ok: true })).to.be.true;
  });

  it("возвращённое значение уходит в ack.data", async () => {
    const socket = createSocket();
    const ack = sinon.stub();

    onValidated(socket as any, "room:subscribe", Schema, () => ({
      joined: true,
    }));
    await socket.fire("room:subscribe", { id: ENTITY_ID }, ack);

    expect(ack.firstCall.args[0]).to.deep.equal({
      ok: true,
      data: { joined: true },
    });
  });

  it("невалидные данные → VALIDATION_ERROR с полями, обработчик не вызван", async () => {
    const socket = createSocket();
    const handler = sinon.stub();
    const ack = sinon.stub();

    onValidated(socket as any, "room:subscribe", Schema, handler);
    await socket.fire("room:subscribe", { id: "nope" }, ack);

    expect(handler.called).to.be.false;
    expect(ack.firstCall.args[0]).to.deep.equal({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Ошибка валидации события",
        details: { id: "Некорректный UUID" },
      },
    });
  });

  it("пустой payload → VALIDATION_ERROR, а не исключение", async () => {
    const socket = createSocket();
    const ack = sinon.stub();

    onValidated(socket as any, "room:subscribe", Schema, sinon.stub());
    await socket.fire("room:subscribe", undefined, ack);

    expect(ack.firstCall.args[0].error.code).to.equal("VALIDATION_ERROR");
  });

  it("доменная ошибка обработчика → её код и сообщение", async () => {
    const socket = createSocket();
    const ack = sinon.stub();

    onValidated(socket as any, "room:subscribe", Schema, () => {
      throw TestError.DENIED();
    });
    await socket.fire("room:subscribe", { id: ENTITY_ID }, ack);

    expect(ack.firstCall.args[0]).to.deep.equal({
      ok: false,
      error: { code: "TEST_DENIED", message: "Нельзя" },
    });
  });

  it("неизвестная ошибка → SOCKET_INTERNAL без текста исключения", async () => {
    const socket = createSocket();
    const ack = sinon.stub();
    const logged = sinon.stub(logger, "error");

    onValidated(socket as any, "room:subscribe", Schema, async () => {
      throw new Error("db password leaked");
    });
    await socket.fire("room:subscribe", { id: ENTITY_ID }, ack);

    const { error } = ack.firstCall.args[0];

    expect(error.code).to.equal("SOCKET_INTERNAL");
    expect(error.message).to.not.contain("password");
    expect(logged.calledOnce).to.be.true;
  });

  it("без ack ошибка уходит событием error с кодом", async () => {
    const socket = createSocket();

    onValidated(socket as any, "room:subscribe", Schema, sinon.stub());
    await socket.fire("room:subscribe", { id: 1 });

    expect(socket.emit.calledOnce).to.be.true;
    expect(socket.emit.firstCall.args[0]).to.equal("error");
    expect(socket.emit.firstCall.args[1]).to.include({
      event: "room:subscribe",
      code: "VALIDATION_ERROR",
    });
  });

  describe("ограничение частоты", () => {
    it("сверх лимита → SOCKET_RATE_LIMITED, обработчик не вызван", async () => {
      const socket = createSocket();
      const handler = sinon.stub();
      const ack = sinon.stub();

      onValidated(socket as any, "room:unsubscribe", Schema, handler, {
        rateLimit: { perSecond: 2 },
      });

      for (let i = 0; i < 3; i += 1) {
        await socket.fire("room:unsubscribe", { id: ENTITY_ID }, ack);
      }

      expect(handler.callCount).to.equal(2);
      expect(ack.thirdCall.args[0].error.code).to.equal("SOCKET_RATE_LIMITED");
    });

    it("без ack превышение отбрасывается молча", async () => {
      const socket = createSocket();
      const handler = sinon.stub();

      onValidated(socket as any, "room:unsubscribe", Schema, handler, {
        rateLimit: { perSecond: 1 },
      });

      await socket.fire("room:unsubscribe", { id: ENTITY_ID });
      await socket.fire("room:unsubscribe", { id: ENTITY_ID });

      expect(handler.callCount).to.equal(1);
      expect(socket.emit.called).to.be.false;
    });

    it("токены восполняются со временем", async () => {
      const socket = createSocket();
      const handler = sinon.stub();

      onValidated(socket as any, "room:unsubscribe", Schema, handler, {
        rateLimit: { perSecond: 2 },
      });

      await socket.fire("room:unsubscribe", { id: ENTITY_ID });
      await socket.fire("room:unsubscribe", { id: ENTITY_ID });
      await socket.fire("room:unsubscribe", { id: ENTITY_ID });
      clock.tick(500);
      await socket.fire("room:unsubscribe", { id: ENTITY_ID });

      expect(handler.callCount).to.equal(3);
    });

    it("лимит считается отдельно по сокету и событию", async () => {
      const a = createSocket();
      const b = createSocket();
      const handler = sinon.stub();
      const limit = { rateLimit: { perSecond: 1 } };

      onValidated(a as any, "room:unsubscribe", Schema, handler, limit);
      onValidated(a as any, "room:subscribe", Schema, handler, limit);
      onValidated(b as any, "room:unsubscribe", Schema, handler, limit);

      await a.fire("room:unsubscribe", { id: ENTITY_ID });
      await a.fire("room:subscribe", { id: ENTITY_ID });
      await b.fire("room:unsubscribe", { id: ENTITY_ID });
      await a.fire("room:unsubscribe", { id: ENTITY_ID });

      expect(handler.callCount).to.equal(3);
    });
  });
});

describe("takeSocketToken", () => {
  it("burst задаёт запас подряд идущих событий", () => {
    const socket = {};
    const limit = { perSecond: 1, burst: 3 };
    const results = [0, 1, 2, 3].map(() =>
      takeSocketToken(socket, "e", limit, 0),
    );

    expect(results).to.deep.equal([true, true, true, false]);
  });

  it("ведро не наполняется выше burst", () => {
    const socket = {};
    const limit = { perSecond: 10, burst: 2 };

    takeSocketToken(socket, "e", limit, 0);

    const later = [0, 1, 2].map(() =>
      takeSocketToken(socket, "e", limit, 60_000),
    );

    expect(later).to.deep.equal([true, true, false]);
  });
});
