import "reflect-metadata";

import { expect } from "chai";

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
  const node = { id: "n1", name: "msk" } as any;
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter>;

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = createMockEmitter();
    new WgNodeListener(eventBus, emitter as any).register();
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
  });

  it("удаление — wg:node:deleted в комнату списка и ноды", () => {
    eventBus.emit(new WgNodeDeletedEvent("n1"));

    expect(
      emitter.toRoom.calledWith(WG_NODES_ROOM, "wg:node:deleted", { id: "n1" }),
    ).to.be.true;
    expect(
      emitter.toRoom.calledWith("wg-node_n1", "wg:node:deleted", { id: "n1" }),
    ).to.be.true;
  });
});
