import { expect } from "chai";
import { randomUUID } from "crypto";

import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("принимает UUID любой версии в любом регистре", () => {
    expect(isUuid(randomUUID())).to.equal(true);
    expect(isUuid("1B4E28BA-2FA1-11D2-883F-0016D3CCA427")).to.equal(true);
  });

  it("отклоняет всё остальное", () => {
    expect(isUuid("")).to.equal(false);
    expect(isUuid("not-a-uuid")).to.equal(false);
    expect(isUuid(`${randomUUID()}x`)).to.equal(false);
    expect(isUuid("1b4e28ba2fa111d2883f0016d3cca427")).to.equal(false);
  });
});
