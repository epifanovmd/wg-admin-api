import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  RoleCreatedEvent,
  RoleDeletedEvent,
  RolePermissionsChangedEvent,
} from "./events";
import { RoleListener, ROLES_ROOM } from "./role.listener";

describe("RoleListener", () => {
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter>;
  const dto = { id: "r1", name: "moderator", permissions: [] };

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = createMockEmitter();
    const roles = {
      getRole: sinon.stub().resolves({ toDTO: () => dto }),
    };

    new RoleListener(eventBus, emitter as any, roles as any).register();
  });

  it("создание и смена прав — role:updated в комнату ролей", async () => {
    await eventBus.emitAsync(new RoleCreatedEvent("r1", "moderator"));
    await eventBus.emitAsync(
      new RolePermissionsChangedEvent("r1", "moderator", []),
    );

    expect(
      emitter.toRoom
        .getCalls()
        .map(c => c.args)
        .filter(([room]) => room === ROLES_ROOM),
    ).to.deep.equal([
      [ROLES_ROOM, "role:updated", dto],
      [ROLES_ROOM, "role:updated", dto],
    ]);
  });

  it("удаление — role:deleted в комнату ролей", async () => {
    await eventBus.emitAsync(new RoleDeletedEvent("r1", "moderator", []));

    expect(emitter.toRoom.calledWith(ROLES_ROOM, "role:deleted", { id: "r1" }))
      .to.be.true;
  });
});
