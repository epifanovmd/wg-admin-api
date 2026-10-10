import { expect } from "chai";

import { datesToIso } from "./zod-validation.decorator";

describe("datesToIso", () => {
  it("даты — ISO-строками на любой глубине, остальное — как есть", () => {
    const at = new Date("2026-10-11T18:40:35.325Z");

    expect(
      datesToIso({ at, list: [at, 1], nested: { at, name: "x" }, none: null }),
    ).to.deep.equal({
      at: "2026-10-11T18:40:35.325Z",
      list: ["2026-10-11T18:40:35.325Z", 1],
      nested: { at: "2026-10-11T18:40:35.325Z", name: "x" },
      none: null,
    });
    expect(datesToIso("text")).to.equal("text");
  });
});
