import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { API_KEYS_ROOM, ApiKeyListener } from "./api-key.listener";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "./events";

describe("ApiKeyListener", () => {
  it("выпуск и отзыв — apikey:updated в комнату ключей", async () => {
    const eventBus = new EventBus();
    const emitter = createMockEmitter();
    const dto = { id: "k1", name: "ci" };
    const keys = { get: sinon.stub().resolves(dto) };

    new ApiKeyListener(eventBus, emitter as any, keys as any).register();
    await eventBus.emitAsync(new ApiKeyCreatedEvent("k1", "u1", "ci", []));
    await eventBus.emitAsync(new ApiKeyRevokedEvent("k1", "u1"));

    expect(emitter.toRoom.getCalls().map(c => c.args)).to.deep.equal([
      [API_KEYS_ROOM, "apikey:updated", dto],
      [API_KEYS_ROOM, "apikey:updated", dto],
    ]);
  });
});
