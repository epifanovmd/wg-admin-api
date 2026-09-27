import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "./event-bus";

class TestEvent {
  readonly payload: string;
  constructor(payload: string) {
    this.payload = payload;
  }
}

class AnotherEvent {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

describe("EventBus", () => {
  let eventBus: EventBus;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventBus();
  });

  afterEach(() => sandbox.restore());

  describe("emit", () => {
    it("should call registered handlers with the event", () => {
      const handler = sandbox.stub();

      eventBus.on(TestEvent, handler);

      const event = new TestEvent("hello");

      eventBus.emit(event);

      expect(handler.calledOnce).to.be.true;
      expect(handler.calledWith(event)).to.be.true;
    });

    it("should call multiple registered handlers", () => {
      const handler1 = sandbox.stub();
      const handler2 = sandbox.stub();

      eventBus.on(TestEvent, handler1);
      eventBus.on(TestEvent, handler2);

      const event = new TestEvent("hello");

      eventBus.emit(event);

      expect(handler1.calledOnce).to.be.true;
      expect(handler2.calledOnce).to.be.true;
    });

    it("should not error when no handlers are registered", () => {
      expect(() => eventBus.emit(new TestEvent("hello"))).to.not.throw();
    });

    it("should handle synchronous errors in handlers without throwing", () => {
      const loggerStub = sandbox.stub(require("../logger").logger, "error");
      const handler = sandbox.stub().throws(new Error("sync error"));

      eventBus.on(TestEvent, handler);

      expect(() => eventBus.emit(new TestEvent("hello"))).to.not.throw();
      expect(loggerStub.calledOnce).to.be.true;
    });

    it("should handle async errors in handlers without throwing", () => {
      sandbox.stub(require("../logger").logger, "error");
      const handler = sandbox.stub().rejects(new Error("async error"));

      eventBus.on(TestEvent, handler);

      expect(() => eventBus.emit(new TestEvent("hello"))).to.not.throw();
      // Async error is caught by .catch — logger will be called asynchronously
    });

    it("should only call handlers for the matching event class", () => {
      const testHandler = sandbox.stub();
      const anotherHandler = sandbox.stub();

      eventBus.on(TestEvent, testHandler);
      eventBus.on(AnotherEvent, anotherHandler);

      eventBus.emit(new TestEvent("hello"));

      expect(testHandler.calledOnce).to.be.true;
      expect(anotherHandler.called).to.be.false;
    });
  });

  describe("emitAsync", () => {
    it("should wait for all handlers to complete", async () => {
      const order: number[] = [];
      const handler1 = sandbox.stub().callsFake(async () => {
        await new Promise(r => setTimeout(r, 10));
        order.push(1);
      });
      const handler2 = sandbox.stub().callsFake(async () => {
        order.push(2);
      });

      eventBus.on(TestEvent, handler1);
      eventBus.on(TestEvent, handler2);

      await eventBus.emitAsync(new TestEvent("hello"));

      expect(handler1.calledOnce).to.be.true;
      expect(handler2.calledOnce).to.be.true;
      expect(order).to.include(1);
      expect(order).to.include(2);
    });

    it("should not throw when no handlers are registered", async () => {
      await eventBus.emitAsync(new TestEvent("hello"));
      // Should complete without error
    });

    it("should log errors for rejected handlers but not throw", async () => {
      const loggerStub = sandbox.stub(require("../logger").logger, "error");
      const handler1 = sandbox.stub().rejects(new Error("fail"));
      const handler2 = sandbox.stub().resolves();

      eventBus.on(TestEvent, handler1);
      eventBus.on(TestEvent, handler2);

      await eventBus.emitAsync(new TestEvent("hello"));

      expect(handler2.calledOnce).to.be.true;
      expect(loggerStub.calledOnce).to.be.true;
    });
  });

  describe("on", () => {
    it("should return an unsubscribe function", () => {
      const handler = sandbox.stub();
      const unsubscribe = eventBus.on(TestEvent, handler);

      expect(unsubscribe).to.be.a("function");

      eventBus.emit(new TestEvent("hello"));
      expect(handler.calledOnce).to.be.true;

      unsubscribe();

      eventBus.emit(new TestEvent("hello"));
      expect(handler.calledOnce).to.be.true; // still 1, not called again
    });

    it("should register handler for the given event class", () => {
      const handler = sandbox.stub();

      eventBus.on(TestEvent, handler);

      eventBus.emit(new TestEvent("data"));
      expect(handler.calledOnce).to.be.true;
    });
  });

  describe("once", () => {
    it("should fire handler only once", () => {
      const handler = sandbox.stub();

      eventBus.once(TestEvent, handler);

      eventBus.emit(new TestEvent("first"));
      eventBus.emit(new TestEvent("second"));

      expect(handler.calledOnce).to.be.true;
      expect(handler.firstCall.args[0].payload).to.equal("first");
    });

    it("should return an unsubscribe function that works before first emit", () => {
      const handler = sandbox.stub();
      const unsubscribe = eventBus.once(TestEvent, handler);

      unsubscribe();

      eventBus.emit(new TestEvent("hello"));
      expect(handler.called).to.be.false;
    });
  });

  describe("off", () => {
    it("should remove a specific handler", () => {
      const handler = sandbox.stub();

      eventBus.on(TestEvent, handler);

      eventBus.emit(new TestEvent("hello"));
      expect(handler.calledOnce).to.be.true;

      eventBus.off(TestEvent, handler);

      eventBus.emit(new TestEvent("hello"));
      expect(handler.calledOnce).to.be.true; // still 1
    });

    it("should not error when removing a handler that was never registered", () => {
      const handler = sandbox.stub();

      expect(() => eventBus.off(TestEvent, handler)).to.not.throw();
    });
  });

  describe("clear", () => {
    it("should remove all handlers for all events", () => {
      const handler1 = sandbox.stub();
      const handler2 = sandbox.stub();

      eventBus.on(TestEvent, handler1);
      eventBus.on(AnotherEvent, handler2);

      eventBus.clear();

      eventBus.emit(new TestEvent("hello"));
      eventBus.emit(new AnotherEvent(42));

      expect(handler1.called).to.be.false;
      expect(handler2.called).to.be.false;
    });
  });
});
