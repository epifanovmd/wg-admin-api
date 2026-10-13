import { expect } from "chai";

import { compareAgentVersions } from "./protocol";

describe("compareAgentVersions", () => {
  it("по числам частей, а не строкой; v в начале не важен", () => {
    expect(compareAgentVersions("1.10.0", "1.9.9")).to.equal(1);
    expect(compareAgentVersions("v1.2.0", "1.2")).to.equal(0);
    expect(compareAgentVersions("1.2.0", "1.2.1")).to.equal(-1);
  });

  it("предварительная версия младше выпуска", () => {
    expect(compareAgentVersions("1.2.0-rc.1", "1.2.0")).to.equal(-1);
    expect(compareAgentVersions("1.2.0", "1.2.0-rc.1")).to.equal(1);
  });
});
