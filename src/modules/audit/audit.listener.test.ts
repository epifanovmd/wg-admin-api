import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { AgentActionAuditedEvent, AgentActionFinishedEvent } from "../agent";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "../api-key";
import {
  AccountLockedEvent,
  LoginFailedEvent,
  TwoFactorEnabledEvent,
  UserLoggedInEvent,
  UserSignedOutEvent,
} from "../auth";
import { BiometricRemovedEvent } from "../biometric";
import { PasskeyAddedEvent } from "../passkeys";
import { SessionTerminatedEvent } from "../session";
import { PasswordChangedEvent } from "../user";
import { AuditListener } from "./audit.listener";
import { AuditEventType } from "./audit.types";

describe("AuditListener", () => {
  let record: sinon.SinonStub;
  let handlers: Map<unknown, (event: unknown) => unknown>;

  const fire = async (event: object) => {
    await handlers.get(event.constructor)?.(event);
  };

  beforeEach(() => {
    record = sinon.stub().resolves();
    handlers = new Map();

    const eventBus = {
      on: (EventClass: unknown, handler: (event: unknown) => unknown) => {
        handlers.set(EventClass, handler);

        return () => {};
      },
    };

    new AuditListener(eventBus as any, { record } as any).register();
  });

  it("records a successful login with method and request", async () => {
    await fire(
      new UserLoggedInEvent("u1", "s1", undefined, "passkey", {
        ip: "1.2.3.4",
        userAgent: "UA",
      }),
    );

    expect(record.firstCall.args[0]).to.deep.equal({
      type: "auth.login.succeeded",
      actorId: "u1",
      subjectId: "s1",
      ip: "1.2.3.4",
      userAgent: "UA",
      meta: { method: "passkey" },
    });
  });

  it("records a failed login and a lockout", async () => {
    await fire(new LoginFailedEvent(null, "x@y.z", "invalid-credentials"));
    await fire(new AccountLockedEvent("u1", "x@y.z", new Date(0)));

    expect(record.firstCall.args[0]).to.include({
      type: "auth.login.failed",
      actorId: null,
    });
    expect(record.secondCall.args[0]).to.include({
      type: "auth.account.locked",
      actorId: "u1",
    });
  });

  it("records 2FA, password, sign-out, passkey and biometric changes", async () => {
    await fire(new TwoFactorEnabledEvent("u1"));
    await fire(new PasswordChangedEvent("u1", "reset"));
    await fire(new PasswordChangedEvent("u1", "change", "s1"));
    await fire(new UserSignedOutEvent("u1", "s1", "all"));
    await fire(new PasskeyAddedEvent("u1", "cred"));
    await fire(new BiometricRemovedEvent("u1", "dev"));

    expect(record.args.map(([entry]) => entry.type)).to.deep.equal([
      "auth.2fa.enabled",
      "auth.password.reset",
      "auth.password.changed",
      "auth.signed-out-all",
      "passkey.added",
      "biometric.removed",
    ]);
  });

  it("records terminated sessions except those ended by sign-out", async () => {
    await fire(new SessionTerminatedEvent("s1", "u1", "sign-out"));
    await fire(new SessionTerminatedEvent("s2", "u1", "password-changed"));

    expect(record.calledOnce).to.be.true;
    expect(record.firstCall.args[0]).to.deep.equal({
      type: "session.terminated",
      actorId: "u1",
      subjectId: "s2",
      meta: { reason: "password-changed" },
    });
  });
  it("records API key creation and revocation", async () => {
    await fire(new ApiKeyCreatedEvent("k1", "owner", "worker", ["worker:*"]));
    await fire(new ApiKeyRevokedEvent("k1", "admin"));

    expect(record.firstCall.args[0]).to.deep.include({
      type: AuditEventType.API_KEY_CREATED,
      actorId: "owner",
      subjectId: "k1",
    });
    expect(record.secondCall.args[0]).to.deep.include({
      type: AuditEventType.API_KEY_REVOKED,
      actorId: "admin",
      subjectId: "k1",
    });
  });

  it("records an agent action and its result; log reads are skipped", async () => {
    await fire(
      new AgentActionAuditedEvent("agent.revoke", "u1", "a1", "a1", {}),
    );
    const finished = (name: string) =>
      new AgentActionFinishedEvent({
        id: "x1",
        agentId: "a1",
        name: name as never,
        actor: "u1",
        status: "done",
        createdAt: 1,
        finishedAt: 2,
      });

    await fire(finished("agent.logs"));
    await fire(finished("worker.restart"));

    expect(record.callCount).to.equal(2);
    expect(record.firstCall.args[0]).to.deep.equal({
      type: AuditEventType.AGENT_ACTION,
      actorId: "u1",
      subjectId: "a1",
      meta: { action: "agent.revoke", agentId: "a1" },
    });
    expect(record.secondCall.args[0]).to.deep.include({
      type: AuditEventType.AGENT_ACTION_RESULT,
      actorId: "u1",
      subjectId: "a1",
    });
  });
});
