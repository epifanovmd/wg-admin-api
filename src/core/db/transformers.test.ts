import { expect } from "chai";

import { bigintNumber } from "./transformers";

describe("bigintNumber", () => {
  it("строка bigint → number, null остаётся null", () => {
    expect(bigintNumber.from("9007199254740991")).to.equal(9007199254740991);
    expect(bigintNumber.from(null)).to.equal(null);
    expect(bigintNumber.to(42)).to.equal(42);
  });
});
