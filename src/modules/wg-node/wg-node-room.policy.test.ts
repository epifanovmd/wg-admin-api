import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgNodeRoomPolicy } from "./wg-node-room.policy";

describe("WgNodeRoomPolicy", () => {
  let access: { scope: sinon.SinonStub };
  let nodes: { findOne: sinon.SinonStub };
  let policy: WgNodeRoomPolicy;

  beforeEach(() => {
    access = { scope: sinon.stub() };
    nodes = { findOne: sinon.stub() };
    policy = new WgNodeRoomPolicy(access as any, nodes as any);
  });

  it("право на все ноды — вход в любую комнату ноды", async () => {
    access.scope.resolves("all");

    expect(await policy.canJoin("u1", "n1")).to.be.true;
    expect(access.scope.calledWith("u1", "wg:node:view")).to.be.true;
    expect(nodes.findOne.called).to.be.false;
  });

  it("own — только своя нода: владелец или создатель", async () => {
    access.scope.resolves("own");
    nodes.findOne.resolves({ ownerId: "u1", createdById: null });
    expect(await policy.canJoin("u1", "n1")).to.be.true;

    nodes.findOne.resolves({ ownerId: "u2", createdById: "u1" });
    expect(await policy.canJoin("u1", "n1")).to.be.true;

    nodes.findOne.resolves({ ownerId: "u2", createdById: "u3" });
    expect(await policy.canJoin("u1", "n1")).to.be.false;

    nodes.findOne.resolves(null);
    expect(await policy.canJoin("u1", "n1")).to.be.false;
  });

  it("без права просмотра — нельзя", async () => {
    access.scope.resolves(null);

    expect(await policy.canJoin("u1", "n1")).to.be.false;
  });
});
