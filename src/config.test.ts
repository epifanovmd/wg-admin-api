import { expect } from "chai";

import { redisKeyPrefix } from "./config";

describe("config: REDIS_KEY_PREFIX", () => {
  it("принимает пустой, один и несколько сегментов", () => {
    for (const value of ["", "wg_admin:", "wg_admin:e2e:"]) {
      expect(redisKeyPrefix.safeParse(value).success, value).to.equal(true);
    }
  });

  it("отклоняет префикс без `:` на конце и с недопустимыми символами", () => {
    for (const value of ["wg_admin", "wg_admin:e2e", "wg admin:", ":", "a::"]) {
      expect(redisKeyPrefix.safeParse(value).success, value).to.equal(false);
    }
  });
});
