import "reflect-metadata";

import { expect } from "chai";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  WgInterfaceCreatedEvent,
  WgInterfaceDeletedEvent,
  WgInterfaceUpdatedEvent,
} from "./events";
import {
  WG_INTERFACES_ROOM,
  WgInterfaceListener,
} from "./wg-interface.listener";

describe("WgInterfaceListener", () => {
  const iface = {
    id: "i1",
    nodeId: "n1",
    replicas: [{ nodeId: "n2" }],
  } as any;
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter>;

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = createMockEmitter();
    new WgInterfaceListener(
      eventBus,
      emitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    ).register();
  });

  const rooms = () => emitter.toRoom.getCalls().map(c => c.args[0]);

  it("создание и изменение — в комнату списка интерфейсов и интерфейса", () => {
    eventBus.emit(new WgInterfaceCreatedEvent(iface));
    eventBus.emit(new WgInterfaceUpdatedEvent(iface));

    expect(rooms()).to.deep.equal([
      WG_INTERFACES_ROOM,
      "wg-interface_i1",
      WG_INTERFACES_ROOM,
      "wg-interface_i1",
    ]);
  });

  it("удаление — в комнату списка интерфейсов и интерфейса", () => {
    eventBus.emit(new WgInterfaceDeletedEvent("i1", ["n1", "n2"]));

    expect(rooms()).to.deep.equal([WG_INTERFACES_ROOM, "wg-interface_i1"]);
    expect(emitter.toRoom.firstCall.args.slice(1)).to.deep.equal([
      "wg:interface:deleted",
      { id: "i1" },
    ]);
  });
});
