import { expect } from "chai";

import { speedBps } from "./wg-stats-math";

describe("wg-stats-math", () => {
  it("скорость по дельте времени", () => {
    expect(speedBps(0, 1000, 1000)).to.equal(1000);
    expect(speedBps(1000, 1000, 1000)).to.equal(0);
    expect(speedBps(1000, 500, 1000)).to.equal(0);
    expect(speedBps(0, 100, 0)).to.equal(0);
  });
});
