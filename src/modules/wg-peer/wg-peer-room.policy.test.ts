import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgOwnPeersRoomPolicy, WgPeerRoomPolicy } from "./wg-peer-room.policy";

describe("WgPeerRoomPolicy", () => {
  let access: { scope: sinon.SinonStub };
  let peers: { findOne: sinon.SinonStub };
  let policy: WgPeerRoomPolicy;

  beforeEach(() => {
    access = { scope: sinon.stub() };
    peers = { findOne: sinon.stub() };
    policy = new WgPeerRoomPolicy(access as any, peers as any);
  });

  it("право на все пиры — вход в любую комнату пира", async () => {
    access.scope.resolves("all");

    expect(await policy.canJoin("u1", "p1")).to.be.true;
    expect(peers.findOne.called).to.be.false;
  });

  it("own — только свой пир: держатель или создатель", async () => {
    access.scope.resolves("own");
    peers.findOne.resolves({ userId: "u2", createdById: "u1" });
    expect(await policy.canJoin("u1", "p1")).to.be.true;

    peers.findOne.resolves({ userId: "u2", createdById: "u3" });
    expect(await policy.canJoin("u1", "p1")).to.be.false;
  });

  it("без права просмотра — нельзя", async () => {
    access.scope.resolves(null);

    expect(await policy.canJoin("u1", "p1")).to.be.false;
  });
});

describe("WgOwnPeersRoomPolicy", () => {
  it("только своя комната и с правом просмотра", async () => {
    const access = { scope: sinon.stub().resolves("own") };
    const policy = new WgOwnPeersRoomPolicy(access as any);

    expect(await policy.canJoin("u1", "u1")).to.be.true;
    expect(await policy.canJoin("u1", "u2")).to.be.false;

    access.scope.resolves(null);
    expect(await policy.canJoin("u1", "u1")).to.be.false;
  });
});
