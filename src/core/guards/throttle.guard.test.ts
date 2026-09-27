import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { TooManyRequestsException } from "../http";
import { ThrottleGuard } from "./throttle.guard";
import { MemoryThrottleStore } from "./throttle.store";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err as TooManyRequestsException;
  }

  return expect.fail("should have thrown");
};

describe("ThrottleGuard", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  const createCtx = (ip = "127.0.0.1") => ({ ip, set: sinon.stub() }) as any;
  const createGuard = (limit: number, windowMs: number) =>
    new (ThrottleGuard(
      limit,
      windowMs,
      undefined,
      new MemoryThrottleStore(),
    ))();

  it("first request passes", async () => {
    expect(await createGuard(5, 60_000).process(createCtx())).to.be.true;
  });

  it("requests within limit pass", async () => {
    const guard = createGuard(3, 60_000);
    const ctx = createCtx();

    expect(await guard.process(ctx)).to.be.true;
    expect(await guard.process(ctx)).to.be.true;
    expect(await guard.process(ctx)).to.be.true;
  });

  it("requests exceeding limit throw 429 with Retry-After header", async () => {
    const guard = createGuard(2, 60_000);
    const ctx = createCtx();

    await guard.process(ctx);
    await guard.process(ctx);

    const err = await expectRejected(guard.process(ctx));

    expect(err).to.be.instanceOf(TooManyRequestsException);
    expect(err.status).to.equal(429);
    expect(ctx.set.calledWith("Retry-After")).to.be.true;
  });

  it("after window expires, counter resets", async () => {
    const guard = createGuard(1, 10_000);
    const ctx = createCtx();

    await guard.process(ctx);
    clock.tick(10_001);

    expect(await guard.process(ctx)).to.be.true;
  });

  it("different IPs have independent counters", async () => {
    const guard = createGuard(1, 60_000);
    const ctx1 = createCtx("10.0.0.1");
    const ctx2 = createCtx("10.0.0.2");

    await guard.process(ctx1);
    expect(await guard.process(ctx2)).to.be.true;

    const err = await expectRejected(guard.process(ctx1));

    expect(err.status).to.equal(429);
  });

  it("Retry-After header contains remaining seconds", async () => {
    const guard = createGuard(1, 30_000);
    const ctx = createCtx();

    await guard.process(ctx);
    clock.tick(10_000);
    await expectRejected(guard.process(ctx));

    expect(ctx.set.firstCall.args).to.deep.equal(["Retry-After", "20"]);
  });

  it("guards with the same name share the counter, different names do not", async () => {
    const store = new MemoryThrottleStore();
    const A = new (ThrottleGuard(1, 60_000, "shared", store))();
    const B = new (ThrottleGuard(1, 60_000, "shared", store))();
    const C = new (ThrottleGuard(1, 60_000, "other", store))();
    const ctx = createCtx();

    await A.process(ctx);
    await expectRejected(B.process(ctx));
    expect(await C.process(ctx)).to.be.true;
  });
});

describe("MemoryThrottleStore", () => {
  it("забывает просроченные ключи при следующем обращении", async () => {
    const clock = sinon.useFakeTimers();
    const store = new MemoryThrottleStore(1_000);

    await store.hit("a", 500);
    clock.tick(2_000);
    await store.hit("b", 500);

    expect((store as any)._records.has("a")).to.be.false;
    clock.restore();
  });
});
