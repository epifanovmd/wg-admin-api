import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeStatusChangedEvent,
  WgNodeUpdatedEvent,
} from "./events";
import { WG_NODES_ROOM, WgNodeListener } from "./wg-node.listener";

describe("WgNodeListener", () => {
  const node = {
    id: "n1",
    name: "msk",
    ownerId: "u1",
    createdById: "u2",
  } as any;
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
    new WgNodeListener(eventBus, emitter as any, owned as any).register();
  });

  const sent = () => emitter.toRoom.getCalls().map(c => [c.args[0], c.args[1]]);

  it("создание, изменение и статус — в комнату списка нод и ноды, не в overview", () => {
    eventBus.emit(new WgNodeCreatedEvent(node));
    eventBus.emit(new WgNodeUpdatedEvent(node));
    eventBus.emit(new WgNodeStatusChangedEvent(node));

    expect(sent()).to.deep.equal([
      [WG_NODES_ROOM, "wg:node:updated"],
      [WG_NODES_ROOM, "wg:node:updated"],
      ["wg-node_n1", "wg:node:updated"],
      [WG_NODES_ROOM, "wg:node:updated"],
      ["wg-node_n1", "wg:node:updated"],
    ]);
    expect(owned.toOwners.callCount).to.equal(3);
    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:node:view",
      "wg:node:updated",
      node,
    ]);
  });

  it("смена владельца — прежнему wg:node:deleted и пересмотр его комнат", async () => {
    await eventBus.emitAsync(new WgNodeUpdatedEvent(node, "u3"));

    expect(owned.detach.calledOnceWith("u3", "wg:node:deleted", { id: "n1" }))
      .to.be.true;
  });

  it("прежний владелец — создатель: нода остаётся своей", async () => {
    await eventBus.emitAsync(new WgNodeUpdatedEvent(node, "u2"));

    expect(owned.detach.called).to.be.false;
  });

  it("удаление — wg:node:deleted в комнату списка, ноды и своим", async () => {
    await eventBus.emitAsync(new WgNodeDeletedEvent("n1", "u1", "u2"));

    expect(
      emitter.toRoom.calledWith(WG_NODES_ROOM, "wg:node:deleted", { id: "n1" }),
    ).to.be.true;
    expect(
      emitter.toRoom.calledWith("wg-node_n1", "wg:node:deleted", { id: "n1" }),
    ).to.be.true;
    expect(
      owned.toOwners.calledOnceWith(
        ["u1", "u2"],
        "wg:node:view",
        "wg:node:deleted",
        {
          id: "n1",
        },
      ),
    ).to.be.true;
  });
});
