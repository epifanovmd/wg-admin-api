import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { createMockEmitter } from "../../test/helpers";
import { OwnedEntityEmitter } from "./owned-entity-emitter";

describe("OwnedEntityEmitter", () => {
  let emitter: ReturnType<typeof createMockEmitter>;
  let rooms: { revalidateUser: sinon.SinonStub };
  let access: { scope: sinon.SinonStub };
  let owned: OwnedEntityEmitter;

  beforeEach(() => {
    emitter = createMockEmitter();
    rooms = { revalidateUser: sinon.stub().resolves() };
    access = { scope: sinon.stub() };
    owned = new OwnedEntityEmitter(emitter as any, rooms as any, access as any);
  });

  it("шлёт лично только пользователям с областью own, без повторов", async () => {
    access.scope.withArgs("u1").resolves("own");
    access.scope.withArgs("u2").resolves("all");
    access.scope.withArgs("u3").resolves(null);

    await owned.toOwners(
      ["u1", "u1", "u2", "u3", null],
      "x:view",
      "wg:peer:deleted",
      {
        id: "p1",
      },
    );

    expect(access.scope.callCount).to.equal(3);
    expect(emitter.toUser.calledOnceWith("u1", "wg:peer:deleted", { id: "p1" }))
      .to.be.true;
  });

  it("ошибка проверки права одного получателя не мешает остальным", async () => {
    access.scope.withArgs("u1").rejects(new Error("db"));
    access.scope.withArgs("u2").resolves("own");

    await owned.toOwners(["u1", "u2"], "x:view", "wg:peer:deleted", {
      id: "p1",
    });

    expect(emitter.toUser.calledOnceWith("u2")).to.be.true;
  });

  it("detach: событие бывшему владельцу и пересмотр его комнат", async () => {
    await owned.detach("u1", "wg:peer:deleted", { id: "p1" });

    expect(emitter.toUser.calledOnceWith("u1", "wg:peer:deleted", { id: "p1" }))
      .to.be.true;
    expect(rooms.revalidateUser.calledOnceWith("u1")).to.be.true;
  });
});
