import { expect } from "chai";

import { toTokenSubject } from "./token-subject";

describe("toTokenSubject", () => {
  it("merges role and direct permissions without duplicates", () => {
    const subject = toTokenSubject({
      id: "u1",
      emailVerified: true,
      roles: [
        { name: "user", permissions: [{ name: "chat:view" }] },
        { name: "moderator", permissions: [{ name: "chat:manage" }] },
      ],
      directPermissions: [{ name: "chat:view" }, { name: "user:view" }],
    } as any);

    expect(subject).to.deep.equal({
      id: "u1",
      roles: ["user", "moderator"],
      permissions: ["chat:view", "chat:manage", "user:view"],
      emailVerified: true,
    });
  });

  it("tolerates unloaded relations", () => {
    expect(
      toTokenSubject({ id: "u1", emailVerified: false } as any),
    ).to.deep.equal({
      id: "u1",
      roles: [],
      permissions: [],
      emailVerified: false,
    });
  });
});
