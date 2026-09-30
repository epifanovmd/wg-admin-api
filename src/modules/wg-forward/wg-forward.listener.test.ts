import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { WgForwardDeletedEvent, WgForwardUpdatedEvent } from "./events";
import { WgForwardListener } from "./wg-forward.listener";
import { WG_FORWARDS_ROOM } from "./wg-forward-room.policy";

describe("WgForwardListener", () => {
  const forward = { id: "f1", ownerId: "u1", createdById: "u2" } as any;
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter>;
  let owned: { toOwners: sinon.SinonStub; detach: sinon.SinonStub };

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = createMockEmitter();
    owned = {
      toOwners: sinon.stub().resolves(),
      detach: sinon.stub().resolves(),
    };
    new WgForwardListener(eventBus, emitter as any, owned as any).register();
  });

  it("изменение — в комнату списка и своим", async () => {
    await eventBus.emitAsync(new WgForwardUpdatedEvent(forward));

    expect(
      emitter.toRoom.calledOnceWith(
        WG_FORWARDS_ROOM,
        "wg:forward:updated",
        forward,
      ),
    ).to.be.true;
    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:forward:view",
      "wg:forward:updated",
      forward,
    ]);
    expect(owned.detach.called).to.be.false;
  });

  it("смена владельца — прежнему wg:forward:deleted, если он не создатель", async () => {
    await eventBus.emitAsync(new WgForwardUpdatedEvent(forward, "u3"));
    await eventBus.emitAsync(new WgForwardUpdatedEvent(forward, "u2"));

    expect(
      owned.detach.calledOnceWith("u3", "wg:forward:deleted", { id: "f1" }),
    ).to.be.true;
  });

  it("удаление — в комнату списка и своим", async () => {
    await eventBus.emitAsync(new WgForwardDeletedEvent("f1", "u1", "u2"));

    expect(
      owned.toOwners.calledOnceWith(
        ["u1", "u2"],
        "wg:forward:view",
        "wg:forward:deleted",
        { id: "f1" },
      ),
    ).to.be.true;
  });
});
