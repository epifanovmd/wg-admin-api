import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { ProfileUpdatedEvent } from "../profile/events";
import { RoleDeletedEvent, RolePermissionsChangedEvent } from "../role";
import {
  EmailChangedEvent,
  EmailVerifiedEvent,
  PasswordChangedEvent,
  UserChangedEvent,
  UserDeletedEvent,
  UsernameChangedEvent,
  UserPrivilegesChangedEvent,
} from "./events";
import { UserListener, USERS_ROOM } from "./user.listener";

describe("UserListener", () => {
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter> & {
    disconnectUser: sinon.SinonStub;
  };
  let userService: {
    notifyRoleMembersPrivilegesChanged: sinon.SinonStub;
    notifyUsersPrivilegesChanged: sinon.SinonStub;
    getUser: sinon.SinonStub;
    toUserDto: sinon.SinonStub;
  };
  let access: { grantOf: sinon.SinonStub };
  let rooms: { revalidateUser: sinon.SinonStub };

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = { ...createMockEmitter(), disconnectUser: sinon.stub() };
    userService = {
      notifyRoleMembersPrivilegesChanged: sinon.stub().resolves(),
      notifyUsersPrivilegesChanged: sinon.stub().resolves(),
      getUser: sinon.stub().callsFake(async (id: string) => ({ id })),
      toUserDto: sinon.stub().callsFake(async (user: { id: string }) => ({
        id: user.id,
        dto: true,
      })),
    };
    access = {
      grantOf: sinon
        .stub()
        .resolves({ roles: ["user"], permissions: ["wg:peer:own", "x:y"] }),
    };
    rooms = { revalidateUser: sinon.stub().resolves() };
    new UserListener(
      eventBus,
      emitter as any,
      userService as any,
      access as any,
      rooms as any,
    ).register();
  });

  it("смена прав: эффективные права пользователю и пересмотр его комнат", async () => {
    await eventBus.emitAsync(
      new UserPrivilegesChangedEvent("u1", ["user"], ["x:y"]),
    );

    expect(
      emitter.toUser.calledWith("u1", "user:privileges-changed", {
        roles: ["user"],
        permissions: ["wg:peer:own", "x:y"],
      }),
    ).to.be.true;
    expect(rooms.revalidateUser.calledOnceWith("u1")).to.be.true;
  });

  it("изменения пользователя — user:updated со свежим UserDto в комнату users", async () => {
    await eventBus.emitAsync(new UserChangedEvent("u1"));
    await eventBus.emitAsync(new UsernameChangedEvent("u1", "neo"));
    await eventBus.emitAsync(new EmailVerifiedEvent("u1"));
    await eventBus.emitAsync(new ProfileUpdatedEvent({ userId: "u1" } as any));

    const sent = emitter.toRoom
      .getCalls()
      .filter(c => c.args[0] === USERS_ROOM);

    expect(sent).to.have.length(4);
    expect(sent[0].args.slice(1)).to.deep.equal([
      "user:updated",
      { id: "u1", dto: true },
    ]);
  });

  it("удаление пользователя — user:deleted в комнату users", () => {
    eventBus.emit(new UserDeletedEvent("u1"));

    expect(emitter.toRoom.calledWith(USERS_ROOM, "user:deleted", { id: "u1" }))
      .to.be.true;
  });

  it("удаление роли — пересчёт прав её бывших пользователей", async () => {
    await eventBus.emitAsync(new RoleDeletedEvent("r1", "moderator", ["u1"]));

    expect(userService.notifyUsersPrivilegesChanged.calledOnceWith(["u1"])).to
      .be.true;
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
