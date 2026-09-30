import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  WgSocksDeletedEvent,
  WgSocksStatsEvent,
  WgSocksUpdatedEvent,
} from "./events";
import { WgSocksListener } from "./wg-socks.listener";
import { WG_SOCKS_ROOM } from "./wg-socks-room.policy";

describe("WgSocksListener", () => {
  const socks = { id: "s1", ownerId: "u1", createdById: "u2" } as any;
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
    new WgSocksListener(eventBus, emitter as any, owned as any).register();
  });

  it("изменение — в комнату списка и своим; смена владельца — detach", async () => {
    await eventBus.emitAsync(new WgSocksUpdatedEvent(socks, "u3"));

    expect(emitter.toRoom.calledOnceWith(WG_SOCKS_ROOM, "wg:socks:updated")).to
      .be.true;
    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:socks:view",
      "wg:socks:updated",
      socks,
    ]);
    expect(owned.detach.calledOnceWith("u3", "wg:socks:deleted", { id: "s1" }))
      .to.be.true;
  });

  it("удаление и статистика — своим", async () => {
    const live = { connections: 1, rxBytes: 1, txBytes: 1, ts: "t" };

    await eventBus.emitAsync(new WgSocksDeletedEvent("s1", "u1", "u2"));
    await eventBus.emitAsync(new WgSocksStatsEvent("s1", live, "u1", null));

    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:socks:view",
      "wg:socks:deleted",
      { id: "s1" },
    ]);
    expect(owned.toOwners.secondCall.args).to.deep.equal([
      ["u1", null],
      "wg:socks:view",
      "wg:socks:stats",
      { id: "s1", live },
    ]);
  });
});
