import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { logger } from "../../core";
import { createMockEmitter, uuid, uuid2 } from "../../test/helpers";
import {
  PasswordChangedEvent,
  UserDeletedEvent,
  UserPrivilegesChangedEvent,
} from "../user/events";
import { SessionTerminatedEvent } from "./events";
import { SessionListener } from "./session.listener";

describe("SessionListener", () => {
  let emitter: ReturnType<typeof createMockEmitter> & Record<string, any>;
  let sessionService: {
    terminateAllByUser: sinon.SinonStub;
    terminateAllOther: sinon.SinonStub;
  };
  let handlers: Record<string, (event: unknown) => Promise<void>>;
  let tokenService: { revokeUser: sinon.SinonStub };

  const userId = uuid();
  const sessionId = uuid2();

  beforeEach(() => {
    emitter = {
      ...createMockEmitter(),
      disconnectSession: sinon.stub().resolves(),
      disconnectUser: sinon.stub(),
    };
    sessionService = {
      terminateAllByUser: sinon.stub().resolves(),
      terminateAllOther: sinon.stub().resolves(),
    };
    handlers = {};
    tokenService = { revokeUser: sinon.stub().resolves() };

    const eventBus = {
      on: (EventClass: { name: string }, handler: any) => {
        handlers[EventClass.name] = handler;

        return () => {};
      },
    };

    new SessionListener(
      eventBus as any,
      emitter as any,
      sessionService as any,
      tokenService as any,
    ).register();
  });

  it("SessionTerminatedEvent notifies and disconnects the session sockets", async () => {
    await handlers.SessionTerminatedEvent(
      new SessionTerminatedEvent(sessionId, userId),
    );

    expect(
      emitter.toUser.calledOnceWith(userId, "session:terminated", {
        sessionId,
      }),
    ).to.be.true;
    expect(emitter.disconnectSession.calledOnceWith(userId, sessionId)).to.be
      .true;
  });

  it("PasswordChangedEvent terminates all sessions except the current one", async () => {
    await handlers.PasswordChangedEvent(
      new PasswordChangedEvent(userId, "change", sessionId),
    );

    expect(
      sessionService.terminateAllOther.calledOnceWith(
        userId,
        sessionId,
        "password-changed",
      ),
    ).to.be.true;
    expect(sessionService.terminateAllByUser.called).to.be.false;
  });

  it("PasswordChangedEvent after reset terminates every session", async () => {
    await handlers.PasswordChangedEvent(
      new PasswordChangedEvent(userId, "reset"),
    );

    expect(sessionService.terminateAllByUser.calledOnceWith(userId)).to.be.true;
    expect(sessionService.terminateAllOther.called).to.be.false;
  });

  it("UserPrivilegesChangedEvent terminates all sessions", async () => {
    await handlers.UserPrivilegesChangedEvent(
      new UserPrivilegesChangedEvent(userId, [], []),
    );

    expect(sessionService.terminateAllByUser.calledOnceWith(userId)).to.be.true;
  });

  it("UserDeletedEvent revokes access tokens and disconnects every socket", async () => {
    await handlers.UserDeletedEvent(new UserDeletedEvent(userId));

    expect(tokenService.revokeUser.calledOnceWith(userId)).to.be.true;
    expect(emitter.disconnectUser.calledOnceWith(userId)).to.be.true;
  });

  it("a failing handler logs instead of rejecting", async () => {
    const logError = sinon.stub(logger, "error");

    sessionService.terminateAllByUser.rejects(new Error("db down"));

    try {
      await handlers.PasswordChangedEvent(
        new PasswordChangedEvent(userId, "change"),
      );
      expect(logError.calledOnce).to.be.true;
    } finally {
      logError.restore();
    }
  });
});
