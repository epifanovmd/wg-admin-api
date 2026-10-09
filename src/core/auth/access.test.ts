import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { AccessService, IGrantResolver } from "./access";

describe("AccessService", () => {
  const serviceWith = (grant: Awaited<ReturnType<IGrantResolver["grantOf"]>>) =>
    new AccessService({ grantOf: sinon.stub().resolves(grant) });

  it("scope: all, own или null по актуальным правам", async () => {
    expect(
      await serviceWith({ roles: [], permissions: ["x:view"] }).scope(
        "u1",
        "x:view",
      ),
    ).to.equal("all");
    expect(
      await serviceWith({ roles: [], permissions: ["x:view:own"] }).scope(
        "u1",
        "x:view",
      ),
    ).to.equal("own");
    expect(
      await serviceWith({ roles: ["admin"], permissions: [] }).scope(
        "u1",
        "x:view",
      ),
    ).to.equal("all");
    expect(await serviceWith(null).scope("u1", "x:view")).to.equal(null);
  });

  it("can: право на все покрывает право «только на свои»", async () => {
    const service = serviceWith({ roles: [], permissions: ["x:view"] });

    expect(await service.can("u1", "x:view:own")).to.be.true;
    expect(
      await serviceWith({ roles: [], permissions: ["x:view:own"] }).can(
        "u1",
        "x:view",
      ),
    ).to.be.false;
  });
});
