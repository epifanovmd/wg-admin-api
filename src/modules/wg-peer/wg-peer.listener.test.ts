import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  WgPeerCreatedEvent,
  WgPeerDeletedEvent,
  WgPeerUpdatedEvent,
} from "./events";
import { WG_PEERS_ROOM, WgPeerListener } from "./wg-peer.listener";

describe("WgPeerListener", () => {
  const peer = { id: "p1", userId: "u2", createdById: "u3" } as any;
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
    new WgPeerListener(eventBus, emitter as any, owned as any).register();
  });

  it("создание и изменение — в комнаты списка и пира и своим, не в overview", async () => {
    await eventBus.emitAsync(new WgPeerCreatedEvent(peer));

    expect(emitter.toRoom.getCalls().map(c => c.args[0])).to.deep.equal([
      WG_PEERS_ROOM,
      "wg-peer_p1",
    ]);
    expect(
      owned.toOwners.calledOnceWith(
        ["u2", "u3"],
        "wg:peer:view",
        "wg:peer:updated",
        peer,
      ),
    ).to.be.true;
  });

  it("смена держателя — прежнему wg:peer:deleted и пересмотр его комнат", async () => {
    await eventBus.emitAsync(new WgPeerUpdatedEvent(peer, "u1"));

    expect(owned.detach.calledOnceWith("u1", "wg:peer:deleted", { id: "p1" }))
      .to.be.true;
  });

  it("прежний держатель — создатель: пир остаётся своим", async () => {
    await eventBus.emitAsync(new WgPeerUpdatedEvent(peer, "u3"));

    expect(owned.detach.called).to.be.false;
  });

  it("без смены держателя — комнаты не пересматриваются", async () => {
    await eventBus.emitAsync(new WgPeerUpdatedEvent(peer, null));

    expect(owned.detach.called).to.be.false;
  });

  it("удаление — в комнаты списка и пира и своим", async () => {
    await eventBus.emitAsync(new WgPeerDeletedEvent("p1", "u2", "u3"));

    expect(emitter.toRoom.getCalls().map(c => c.args[0])).to.deep.equal([
      WG_PEERS_ROOM,
      "wg-peer_p1",
    ]);
    expect(
      owned.toOwners.calledOnceWith(
        ["u2", "u3"],
        "wg:peer:view",
        "wg:peer:deleted",
        { id: "p1" },
      ),
    ).to.be.true;
  });
});
