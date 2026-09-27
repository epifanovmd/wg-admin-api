import { expect } from "chai";
import sinon from "sinon";

import { AttemptsStore, MemoryAttemptsStore } from "./auth-attempts.store";

describe("MemoryAttemptsStore", () => {
  let clock: sinon.SinonFakeTimers;
  let store: MemoryAttemptsStore;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    store = new MemoryAttemptsStore();
  });

  afterEach(() => clock.restore());

  it("counts failures within the window and forgets them after", async () => {
    expect(await store.addFailure("k", 1_000)).to.equal(1);
    expect(await store.addFailure("k", 1_000)).to.equal(2);
    expect(await store.getFailures("k")).to.equal(2);

    clock.tick(1_001);

    expect(await store.getFailures("k")).to.equal(0);
  });

  it("resets failures", async () => {
    await store.addFailure("k", 1_000);
    await store.resetFailures("k");

    expect(await store.getFailures("k")).to.equal(0);
  });

  it("reports the remaining lifetime of a key", async () => {
    expect(await store.ttlMs("lock")).to.equal(0);

    await store.claimOnce("lock", 1_000);
    clock.tick(400);

    expect(await store.ttlMs("lock")).to.equal(600);
  });

  it("prefixes keys of a namespaced store", async () => {
    const namespaced = new AttemptsStore("ns:", store);

    await namespaced.addFailure("k", 1_000);

    expect(await store.getFailures("ns:k")).to.equal(1);
    expect(await namespaced.getFailures("k")).to.equal(1);
  });

  it("claims a key only once until it expires", async () => {
    expect(await store.claimOnce("jti", 1_000)).to.be.true;
    expect(await store.claimOnce("jti", 1_000)).to.be.false;

    clock.tick(1_001);

    expect(await store.claimOnce("jti", 1_000)).to.be.true;
  });
});
