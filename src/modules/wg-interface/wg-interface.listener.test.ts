import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

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
    ownerId: "u1",
    createdById: "u2",
    replicas: [{ nodeId: "n2" }],
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
    new WgInterfaceListener(
      eventBus,
      emitter as any,
      owned as any,
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
    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:interface:view",
      "wg:interface:updated",
      iface,
    ]);
  });

  it("смена владельца — прежнему wg:interface:deleted и пересмотр его комнат", async () => {
    await eventBus.emitAsync(new WgInterfaceUpdatedEvent(iface, null, "u3"));

    expect(
      owned.detach.calledOnceWith("u3", "wg:interface:deleted", { id: "i1" }),
    ).to.be.true;
  });

  it("прежний владелец — создатель: интерфейс остаётся своим", async () => {
    await eventBus.emitAsync(new WgInterfaceUpdatedEvent(iface, null, "u2"));

    expect(owned.detach.called).to.be.false;
  });

  it("удаление — в комнату списка интерфейсов, интерфейса и своим", async () => {
    await eventBus.emitAsync(
      new WgInterfaceDeletedEvent("i1", ["n1", "n2"], null, "u1", "u2"),
    );

    expect(rooms()).to.deep.equal([WG_INTERFACES_ROOM, "wg-interface_i1"]);
    expect(emitter.toRoom.firstCall.args.slice(1)).to.deep.equal([
      "wg:interface:deleted",
      { id: "i1" },
    ]);
    expect(
      owned.toOwners.calledOnceWith(
        ["u1", "u2"],
        "wg:interface:view",
        "wg:interface:deleted",
        { id: "i1" },
      ),
    ).to.be.true;
  });
});
