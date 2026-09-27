import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { RolePermissionsChangedEvent } from "../role";
import {
  EmailChangedEvent,
  PasswordChangedEvent,
  UserDeletedEvent,
} from "./events";
import { UserListener } from "./user.listener";

describe("UserListener", () => {
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter> & {
    disconnectUser: sinon.SinonStub;
  };
  let userService: { notifyRoleMembersPrivilegesChanged: sinon.SinonStub };

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = { ...createMockEmitter(), disconnectUser: sinon.stub() };
    userService = {
      notifyRoleMembersPrivilegesChanged: sinon.stub().resolves(),
    };
    new UserListener(eventBus, emitter as any, userService as any).register();
  });

  it("should fan out role permission changes to role members", () => {
    eventBus.emit(new RolePermissionsChangedEvent("role-1", "user", []));

    expect(userService.notifyRoleMembersPrivilegesChanged.calledWith("role-1"))
      .to.be.true;
  });

  it("should not terminate every session itself on password change", () => {
    eventBus.emit(new PasswordChangedEvent("u1", "change", "s1"));

    const events = emitter.toUser.getCalls().map(c => c.args[1]);

    expect(events).to.deep.equal(["user:password-changed"]);
  });

  it("should disconnect sockets of a deleted user", () => {
    eventBus.emit(new UserDeletedEvent("u1"));

    expect(emitter.disconnectUser.calledWith("u1")).to.be.true;
  });

  it("смена email — user:email-changed с новым адресом", () => {
    eventBus.emit(new EmailChangedEvent("u1", "old@x.test", "new@x.test"));

    expect(
      emitter.toUser.calledWith("u1", "user:email-changed", {
        email: "new@x.test",
      }),
    ).to.be.true;
  });
});
