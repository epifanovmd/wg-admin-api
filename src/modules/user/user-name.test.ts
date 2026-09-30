import { expect } from "chai";

import { userDisplayName } from "./user-name";

describe("userDisplayName", () => {
  it("имя и фамилия профиля", () => {
    expect(
      userDisplayName({
        email: "a@x.io",
        profile: { firstName: "Иван", lastName: "Петров" },
      }),
    ).to.equal("Иван Петров");
    expect(
      userDisplayName({
        email: "a@x.io",
        profile: { firstName: null, lastName: "Петров" },
      }),
    ).to.equal("Петров");
  });

  it("без имени в профиле — email", () => {
    expect(
      userDisplayName({
        email: "a@x.io",
        profile: { firstName: null, lastName: null },
      }),
    ).to.equal("a@x.io");
    expect(userDisplayName({ email: "a@x.io", profile: null })).to.equal(
      "a@x.io",
    );
  });

  it("нет пользователя или ни имени, ни email — null", () => {
    expect(userDisplayName(null)).to.equal(null);
    expect(userDisplayName(undefined)).to.equal(null);
    expect(userDisplayName({ email: null })).to.equal(null);
  });
});
