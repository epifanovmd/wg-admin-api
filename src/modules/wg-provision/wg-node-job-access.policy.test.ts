import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgNodeJobAccessPolicy } from "./wg-node-job-access.policy";

describe("WgNodeJobAccessPolicy", () => {
  let access: { scope: sinon.SinonStub };
  let nodes: { findOne: sinon.SinonStub };
  let policy: WgNodeJobAccessPolicy;

  beforeEach(() => {
    access = { scope: sinon.stub() };
    nodes = { findOne: sinon.stub() };
    policy = new WgNodeJobAccessPolicy(access as any, nodes as any);
  });

  it("просмотр — право просмотра нод, отмена — право установки", async () => {
    access.scope.resolves("all");

    expect(await policy.canAccess("u1", "n1", "view")).to.be.true;
    expect(access.scope.lastCall.args).to.deep.equal(["u1", "wg:node:view"]);

    expect(await policy.canAccess("u1", "n1", "cancel")).to.be.true;
    expect(access.scope.lastCall.args).to.deep.equal([
      "u1",
      "wg:node:provision",
    ]);
  });

  it("own — только задачи своей ноды", async () => {
    access.scope.resolves("own");
    nodes.findOne.resolves({ ownerId: null, createdById: "u1" });
    expect(await policy.canAccess("u1", "n1", "view")).to.be.true;

    nodes.findOne.resolves({ ownerId: "u2", createdById: null });
    expect(await policy.canAccess("u1", "n1", "view")).to.be.false;
  });

  it("без права — нельзя", async () => {
    access.scope.resolves(null);

    expect(await policy.canAccess("u1", "n1", "view")).to.be.false;
  });
});
