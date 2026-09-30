import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgInterfaceRoomPolicy } from "./wg-interface-room.policy";

describe("WgInterfaceRoomPolicy", () => {
  let access: { scope: sinon.SinonStub };
  let ifaces: { findOne: sinon.SinonStub };
  let policy: WgInterfaceRoomPolicy;

  beforeEach(() => {
    access = { scope: sinon.stub() };
    ifaces = { findOne: sinon.stub() };
    policy = new WgInterfaceRoomPolicy(access as any, ifaces as any);
  });

  it("право на все интерфейсы — вход в любую комнату интерфейса", async () => {
    access.scope.resolves("all");

    expect(await policy.canJoin("u1", "i1")).to.be.true;
    expect(access.scope.calledWith("u1", "wg:interface:view")).to.be.true;
    expect(ifaces.findOne.called).to.be.false;
  });

  it("own — только свой интерфейс: владелец или создатель", async () => {
    access.scope.resolves("own");
    ifaces.findOne.resolves({ ownerId: "u1", createdById: null });
    expect(await policy.canJoin("u1", "i1")).to.be.true;

    ifaces.findOne.resolves({ ownerId: "u2", createdById: "u1" });
    expect(await policy.canJoin("u1", "i1")).to.be.true;

    ifaces.findOne.resolves({ ownerId: "u2", createdById: "u3" });
    expect(await policy.canJoin("u1", "i1")).to.be.false;

    ifaces.findOne.resolves(null);
    expect(await policy.canJoin("u1", "i1")).to.be.false;
  });

  it("без права просмотра — нельзя", async () => {
    access.scope.resolves(null);

    expect(await policy.canJoin("u1", "i1")).to.be.false;
  });
});
