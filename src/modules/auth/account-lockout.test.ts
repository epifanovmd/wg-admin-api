import { expect } from "chai";
import sinon from "sinon";

import {
  AccountLockout,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILURES,
} from "./account-lockout";
import { MemoryAttemptsStore } from "./auth-attempts.store";

describe("AccountLockout", () => {
  let clock: sinon.SinonFakeTimers;
  let lockout: AccountLockout;

  const failTimes = async (n: number) => {
    let last = { locked: false, retryAfterSec: 0 };

    for (let i = 0; i < n; i += 1) last = await lockout.registerFailure("k");

    return last;
  };

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    lockout = new AccountLockout(new MemoryAttemptsStore());
  });

  afterEach(() => clock.restore());

  it("locks after the limit and reports Retry-After", async () => {
    expect((await failTimes(LOGIN_MAX_FAILURES - 1)).locked).to.be.false;
    expect(await lockout.registerFailure("k")).to.deep.equal({
      locked: true,
      retryAfterSec: LOGIN_LOCK_MS / 1000,
    });

    clock.tick(60_000);

    expect(await lockout.status("k")).to.deep.equal({
      locked: true,
      retryAfterSec: (LOGIN_LOCK_MS - 60_000) / 1000,
    });
  });

  it("unlocks when the lock expires", async () => {
    await failTimes(LOGIN_MAX_FAILURES);
    clock.tick(LOGIN_LOCK_MS + 1);

    expect((await lockout.status("k")).locked).to.be.false;
  });

  it("forgets failures outside the window", async () => {
    await failTimes(LOGIN_MAX_FAILURES - 1);
    clock.tick(LOGIN_FAILURE_WINDOW_MS + 1);

    expect((await lockout.registerFailure("k")).locked).to.be.false;
  });

  it("unlock removes the lock and the counter", async () => {
    await failTimes(LOGIN_MAX_FAILURES);
    await lockout.unlock("k");

    expect((await lockout.status("k")).locked).to.be.false;
    expect((await failTimes(LOGIN_MAX_FAILURES - 1)).locked).to.be.false;
  });
});
