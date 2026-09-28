import { expect } from "chai";
import sinon from "sinon";

import { permissionRoomPolicy } from "./permission-room.policy";

describe("permissionRoomPolicy", () => {
  it("одна комната на тип, вход — по праву", async () => {
    const Policy = permissionRoomPolicy("users", "user:view");
    const access = { can: sinon.stub().resolves(true) };
    const policy = new Policy(access as any);

    expect(policy.type).to.equal("users");
    expect(policy.room()).to.equal("users");
    expect(await policy.canJoin("u1")).to.be.true;
    expect(access.can.calledOnceWith("u1", "user:view")).to.be.true;
  });
});
