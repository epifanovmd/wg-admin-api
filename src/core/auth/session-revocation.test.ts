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
  };
  const backend: IRevocationBackend & { lookup: sinon.SinonStub } = {
    revokeSessions: async ids => {
      ids.forEach(id => state.sessions.add(id));
    },
    revokeUser: async (userId, atSec) => {
      state.users.set(userId, atSec);
    },
    lookup: sinon
      .stub()
      .callsFake(async (sessionId: string, userId: string) => ({
        sessionRevoked: state.sessions.has(sessionId),
        userRevokedAt: state.users.get(userId) ?? null,
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

    expect(await list.isRevoked("s1", "u1", 0)).to.be.true;
    expect(await list.isRevoked("s2", "u1", 0)).to.be.false;
  });

  it("forgets a revocation after the access-token lifetime", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });

    await list.revokeSessions(["s1"]);
    clock.tick(60_001);

    expect(await list.isRevoked("s1", "u1", 0)).to.be.false;
  });

  it("asks the shared store once per cache window", async () => {
    const { backend } = makeShared();
    const list = new SessionRevocationList({
      shared: backend,
      cacheTtlMs: 1_000,
    });

    await list.isRevoked("s1", "u1", 0);
    await list.isRevoked("s1", "u1", 0);
    expect(backend.lookup.callCount).to.equal(1);

    clock.tick(1_001);
    await list.isRevoked("s1", "u1", 0);
    expect(backend.lookup.callCount).to.equal(2);
  });

  it("picks up a revocation made by another replica after the cache window", async () => {
    const { state, backend } = makeShared();
    const list = new SessionRevocationList({
      shared: backend,
      cacheTtlMs: 1_000,
    });

    expect(await list.isRevoked("s1", "u1", 0)).to.be.false;
    state.sessions.add("s1");
    clock.tick(1_001);

    expect(await list.isRevoked("s1", "u1", 0)).to.be.true;
  });

  it("revokes user tokens issued up to the revocation moment", async () => {
    const list = new SessionRevocationList({ ttlMs: () => 60_000 });
    const now = Math.floor(Date.now() / 1000);

    await list.revokeUser("u1");

    expect(await list.isRevoked("s1", "u1", now - 5)).to.be.true;
    expect(await list.isRevoked("s1", "u1", now + 5)).to.be.false;
    expect(await list.isRevoked("s1", "u2", now - 5)).to.be.false;
  });

  it("fails open when the shared store is unavailable", async () => {
    const list = new SessionRevocationList({
      shared: {
        revokeSessions: async () => {},
        revokeUser: async () => {},
        lookup: sinon.stub().rejects(new Error("down")),
      },
    });

    expect(await list.isRevoked("s1", "u1", 0)).to.be.false;
  });

  it("evicts the oldest cache entry beyond the limit", async () => {
    const { backend } = makeShared();
    const list = new SessionRevocationList({ shared: backend, cacheSize: 1 });

    await list.isRevoked("s1", "u1", 0);
    await list.isRevoked("s2", "u1", 0);
    await list.isRevoked("s1", "u1", 0);

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
