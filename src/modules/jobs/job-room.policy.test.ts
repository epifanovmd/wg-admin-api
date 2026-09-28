import { expect } from "chai";
import sinon from "sinon";

import { JobRoomPolicy } from "./job-room.policy";

describe("JobRoomPolicy", () => {
  it("суперпользователь входит в комнату чужой задачи", async () => {
    const jobs = {
      canView: sinon
        .stub()
        .callsFake(async (_u: string, _id: string, su: boolean) => su),
    };
    const access = { isSuperUser: sinon.stub().resolves(true) };
    const policy = new JobRoomPolicy(jobs as any, access as any);

    expect(await policy.canJoin("admin", "job-1")).to.be.true;
    expect(jobs.canView.calledOnceWith("admin", "job-1", true)).to.be.true;
  });

  it("обычный пользователь — по правилам задачи", async () => {
    const jobs = { canView: sinon.stub().resolves(false) };
    const access = { isSuperUser: sinon.stub().resolves(false) };
    const policy = new JobRoomPolicy(jobs as any, access as any);

    expect(await policy.canJoin("u1", "job-1")).to.be.false;
    expect(jobs.canView.calledOnceWith("u1", "job-1", false)).to.be.true;
  });
});
