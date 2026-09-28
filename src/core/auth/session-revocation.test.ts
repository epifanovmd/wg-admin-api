import { expect } from "chai";
import sinon from "sinon";

import {
  IRevocationBackend,
  parseTtlMs,
  SessionRevocationList,
} from "./session-revocation";

const makeShared = () => {
  const state = {
    sessions: new Set<string>(),
    users: new Map<string, number>(),
    privileges: new Map<string, number>(),
  };
  const backend: IRevocationBackend & { lookup: sinon.SinonStub } = {
    revokeSessions: async ids => {
      ids.forEach(id => state.sessions.add(id));
    },
    revokeUser: async (userId, atSec) => {
      state.users.set(userId, atSec);
    },
    markPrivilegesChanged: async (userId, atMs) => {
      state.privileges.set(userId, atMs);
    },
    lookup: sinon
      .stub()
      .callsFake(async (sessionId: string, userId: string) => ({
        sessionRevoked: state.sessions.has(sessionId),
        userRevokedAt: state.users.get(userId) ?? null,
        privilegesChangedAt: state.privileges.get(userId) ?? null,
      })),
  };

  return { state, backend };
};

describe("SessionRevocationList", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_700_000_000_000 });
  });

  afterEach(() => clock.restore());

  it("sees own revocations immediately without the shared store", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });

    await list.revokeSessions(["s1"]);

    expect(await list.check("s1", "u1", 0)).to.equal("revoked");
    expect(await list.check("s2", "u1", 0)).to.be.null;
  });

  it("forgets a revocation after the access-token lifetime", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });

    await list.revokeSessions(["s1"]);
    clock.tick(60_001);

    expect(await list.check("s1", "u1", 0)).to.be.null;
  });

  it("asks the shared store once per cache window", async () => {
    const { backend } = makeShared();
    const list = new SessionRevocationList({
      shared: backend,
      cacheTtlMs: 1_000,
    });

    await list.check("s1", "u1", 0);
    await list.check("s1", "u1", 0);
    expect(backend.lookup.callCount).to.equal(1);

    clock.tick(1_001);
    await list.check("s1", "u1", 0);
    expect(backend.lookup.callCount).to.equal(2);
  });

  it("picks up a revocation made by another replica after the cache window", async () => {
    const { state, backend } = makeShared();
    const list = new SessionRevocationList({
      shared: backend,
      cacheTtlMs: 1_000,
    });

    expect(await list.check("s1", "u1", 0)).to.be.null;
    state.sessions.add("s1");
    clock.tick(1_001);

    expect(await list.check("s1", "u1", 0)).to.equal("revoked");
  });

  it("revokes user tokens issued up to the revocation moment", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });
    const now = Math.floor(Date.now() / 1000);

    await list.revokeUser("u1");

    expect(await list.check("s1", "u1", now - 5)).to.equal("revoked");
    expect(await list.check("s1", "u1", now + 5)).to.be.null;
    expect(await list.check("s1", "u2", now - 5)).to.be.null;
  });

  it("tokens issued up to a privileges change are stale, later ones pass", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });
    const nowSec = Math.floor(Date.now() / 1000);

    await list.markPrivilegesChanged("u1");

    expect(await list.check("s1", "u1", nowSec, Date.now() - 1)).to.equal(
      "privileges-changed",
    );
    expect(await list.check("s1", "u1", nowSec, Date.now())).to.equal(
      "privileges-changed",
    );
    expect(await list.check("s1", "u1", nowSec, Date.now() + 1)).to.be.null;
    expect(await list.check("s1", "u2", nowSec, Date.now() - 1)).to.be.null;
  });

  it("without a millisecond claim the privileges change compares seconds", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });
    const nowSec = Math.floor(Date.now() / 1000);

    await list.markPrivilegesChanged("u1");

    expect(await list.check("s1", "u1", nowSec - 1)).to.equal(
      "privileges-changed",
    );
    expect(await list.check("s1", "u1", nowSec + 1)).to.be.null;
  });

  it("picks up a privileges change made by another replica", async () => {
    const { state, backend } = makeShared();
    const list = new SessionRevocationList({
      shared: backend,
      cacheTtlMs: 1_000,
    });

    state.privileges.set("u1", Date.now());

    expect(await list.check("s1", "u1", 0, Date.now() - 1)).to.equal(
      "privileges-changed",
    );
  });

  it("a revoked session wins over a privileges change", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });

    await list.markPrivilegesChanged("u1");
    await list.revokeSessions(["s1"]);

    expect(await list.check("s1", "u1", 0, 0)).to.equal("revoked");
  });

  it("fails open when the shared store is unavailable", async () => {
    const list = new SessionRevocationList({
      shared: {
        revokeSessions: async () => {},
        revokeUser: async () => {},
        markPrivilegesChanged: async () => {},
        lookup: sinon.stub().rejects(new Error("down")),
      },
    });

    expect(await list.check("s1", "u1", 0)).to.be.null;
  });

  it("evicts the oldest cache entry beyond the limit", async () => {
    const { backend } = makeShared();
    const list = new SessionRevocationList({ shared: backend, cacheSize: 1 });

    await list.check("s1", "u1", 0);
    await list.check("s2", "u1", 0);
    await list.check("s1", "u1", 0);

    expect(backend.lookup.callCount).to.equal(3);
  });
});

describe("parseTtlMs", () => {
  it("parses jsonwebtoken durations", () => {
    expect(parseTtlMs("15m")).to.equal(900_000);
    expect(parseTtlMs("1d")).to.equal(86_400_000);
    expect(parseTtlMs("30s")).to.equal(30_000);
    expect(parseTtlMs("500")).to.equal(500);
    expect(parseTtlMs(60)).to.equal(60_000);
    expect(parseTtlMs("bad")).to.equal(0);
  });
});
