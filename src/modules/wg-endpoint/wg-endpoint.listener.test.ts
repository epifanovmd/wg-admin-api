import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import {
  WgEndpointChangedEvent,
  WgEndpointCreatedEvent,
  WgEndpointDeletedEvent,
} from "./events";
import { WgEndpointListener } from "./wg-endpoint.listener";
import { WG_ENDPOINTS_ROOM } from "./wg-endpoint-room.policy";

describe("WgEndpointListener", () => {
  const endpoint = { id: "e1", ownerId: "u1", createdById: "u2" } as any;
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
    new WgEndpointListener(eventBus, emitter as any, owned as any).register();
  });

  it("создание и изменение — в комнату списка и своим", async () => {
    await eventBus.emitAsync(new WgEndpointCreatedEvent(endpoint));

    expect(
      emitter.toRoom.calledOnceWith(
        WG_ENDPOINTS_ROOM,
        "wg:endpoint:updated",
        endpoint,
      ),
    ).to.be.true;
    expect(owned.toOwners.firstCall.args).to.deep.equal([
      ["u1", "u2"],
      "wg:endpoint:view",
      "wg:endpoint:updated",
      endpoint,
    ]);
  });

  it("смена владельца — прежнему wg:endpoint:deleted, если он не создатель", async () => {
    await eventBus.emitAsync(new WgEndpointChangedEvent(endpoint, "u3"));
    expect(
      owned.detach.calledOnceWith("u3", "wg:endpoint:deleted", { id: "e1" }),
    ).to.be.true;

    await eventBus.emitAsync(new WgEndpointChangedEvent(endpoint, "u2"));
    expect(owned.detach.calledOnce).to.be.true;
  });

  it("удаление — в комнату списка и своим", async () => {
    await eventBus.emitAsync(new WgEndpointDeletedEvent("e1", "u1", "u2"));

    expect(
      emitter.toRoom.calledOnceWith(WG_ENDPOINTS_ROOM, "wg:endpoint:deleted", {
        id: "e1",
      }),
    ).to.be.true;
    expect(
      owned.toOwners.calledOnceWith(
        ["u1", "u2"],
        "wg:endpoint:view",
        "wg:endpoint:deleted",
        { id: "e1" },
      ),
    ).to.be.true;
  });
});
