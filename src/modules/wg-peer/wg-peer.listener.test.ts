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
  const peer = { id: "p1", userId: "u2" } as any;
  let eventBus: EventBus;
  let emitter: ReturnType<typeof createMockEmitter>;
  let rooms: { revalidateUser: sinon.SinonStub };

  beforeEach(() => {
    eventBus = new EventBus();
    emitter = createMockEmitter();
    rooms = { revalidateUser: sinon.stub().resolves() };
    new WgPeerListener(eventBus, emitter as any, rooms as any).register();
  });

  it("создание и изменение — в комнаты списка и пира и держателю, не в overview", () => {
    eventBus.emit(new WgPeerCreatedEvent(peer));

    expect(emitter.toRoom.getCalls().map(c => c.args[0])).to.deep.equal([
      WG_PEERS_ROOM,
      "wg-peer_p1",
    ]);
    expect(emitter.toUser.calledOnceWith("u2", "wg:peer:updated", peer)).to.be
      .true;
  });

  it("смена держателя — прежнему wg:peer:deleted и пересмотр его комнат", async () => {
    await eventBus.emitAsync(new WgPeerUpdatedEvent(peer, "u1"));

    expect(emitter.toUser.calledWith("u1", "wg:peer:deleted", { id: "p1" })).to
      .be.true;
    expect(emitter.toUser.calledWith("u2", "wg:peer:updated", peer)).to.be.true;
    expect(rooms.revalidateUser.calledOnceWith("u1")).to.be.true;
  });

  it("без смены держателя — комнаты не пересматриваются", async () => {
    await eventBus.emitAsync(new WgPeerUpdatedEvent(peer, null));

    expect(rooms.revalidateUser.called).to.be.false;
  });

  it("удаление — в комнаты списка и пира и держателю", () => {
    eventBus.emit(new WgPeerDeletedEvent("p1", "u2"));

    expect(emitter.toRoom.getCalls().map(c => c.args[0])).to.deep.equal([
      WG_PEERS_ROOM,
      "wg-peer_p1",
    ]);
    expect(emitter.toUser.calledOnceWith("u2", "wg:peer:deleted", { id: "p1" }))
      .to.be.true;
  });
});
