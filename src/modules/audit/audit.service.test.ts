import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { decodeCursor, encodeCursor, logger } from "../../core";
import { createMockRepository, uuid } from "../../test/helpers";
import { AuditService } from "./audit.service";
import { AUDIT_RETENTION_DAYS, AuditEventType } from "./audit.types";

describe("AuditService", () => {
  let repo: ReturnType<typeof createMockRepository> & Record<string, any>;
  let service: AuditService;

  const makeEvent = (i: number) => ({
    id: `00000000-0000-0000-0000-00000000000${i}`,
    type: AuditEventType.LOGIN_SUCCEEDED,
    actorId: uuid(),
    subjectId: null,
    ip: null,
    userAgent: null,
    meta: {},
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  });

  beforeEach(() => {
    repo = createMockRepository() as any;
    repo.insert = sinon.stub().resolves();
    repo.findFeed = sinon.stub().resolves([]);
    repo.deleteOlderThan = sinon.stub().resolves(0);
    service = new AuditService(repo as any);
  });

  describe("record", () => {
    it("stores the entry with clipped strings", async () => {
      await service.record({
        type: AuditEventType.LOGIN_FAILED,
        actorId: uuid(),
        ip: "1.2.3.4",
        userAgent: "x".repeat(600),
        meta: { reason: "invalid-credentials" },
      });

      const [row] = repo.insert.firstCall.args;

      expect(row.type).to.equal("auth.login.failed");
      expect(row.userAgent).to.have.length(500);
      expect(row.subjectId).to.be.null;
      expect(row.meta).to.deep.equal({ reason: "invalid-credentials" });
    });

    it("logs a DB failure instead of throwing", async () => {
      const logError = sinon.stub(logger, "error");

      repo.insert.rejects(new Error("db down"));

      try {
        await service.record({ type: AuditEventType.SIGNED_OUT });
        expect(logError.calledOnce).to.be.true;
      } finally {
        logError.restore();
      }
    });
  });

  describe("list", () => {
    it("returns a page and a cursor when more rows exist", async () => {
      repo.findFeed.resolves([makeEvent(3), makeEvent(2), makeEvent(1)]);

      const page = await service.list({ actorId: uuid() }, undefined, 2);

      expect(repo.findFeed.firstCall.args.slice(0, 2)).to.deep.equal([
        { actorId: uuid() },
        2,
      ]);
      expect(page.items.map(i => i.id)).to.deep.equal([
        makeEvent(3).id,
        makeEvent(2).id,
      ]);
      expect(decodeCursor(page.nextCursor!)).to.deep.equal({
        t: makeEvent(2).createdAt.toISOString(),
        id: makeEvent(2).id,
      });
    });

    it("returns no cursor on the last page", async () => {
      repo.findFeed.resolves([makeEvent(1)]);

      const page = await service.list({}, undefined, 2);

      expect(page.nextCursor).to.be.null;
    });

    it("passes the decoded cursor to the repository", async () => {
      const cursor = encodeCursor({
        t: "2026-01-01T00:00:02.000Z",
        id: makeEvent(2).id,
      });

      await service.list({ type: "auth.login.failed" }, cursor);

      const [, limit, after] = repo.findFeed.firstCall.args;

      expect(limit).to.equal(20);
      expect(after.id).to.equal(makeEvent(2).id);
      expect(after.createdAt.toISOString()).to.equal(
        "2026-01-01T00:00:02.000Z",
      );
    });

    it("rejects a malformed cursor with AUDIT_INVALID_CURSOR", async () => {
      const err = await service.list({}, "not-a-cursor").catch(e => e);

      expect(err).to.include({ status: 400, code: "AUDIT_INVALID_CURSOR" });
    });
  });

  describe("cleanup", () => {
    it("deletes events older than the retention period", async () => {
      const now = new Date("2026-09-25T00:00:00.000Z");

      await service.cleanup(now);

      const [before] = repo.deleteOlderThan.firstCall.args;

      expect(now.getTime() - before.getTime()).to.equal(
        AUDIT_RETENTION_DAYS * 86_400_000,
      );
    });
  });
});
