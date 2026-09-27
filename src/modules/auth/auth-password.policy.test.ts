import { expect } from "chai";

import { AuthPasswordPolicy } from "./auth-password.policy";

describe("AuthPasswordPolicy", () => {
  const policy = new AuthPasswordPolicy();

  it("accepts a password that passes the policy", () => {
    expect(() =>
      policy.validate("Correct-Horse-42", { email: "a@b.c" }),
    ).to.not.throw();
  });

  it("throws VALIDATION_ERROR for a weak password", () => {
    expect(() => policy.validate("password123", {}))
      .to.throw()
      .with.property("code", "VALIDATION_ERROR");
  });

  it("throws for a password equal to the email", () => {
    expect(() =>
      policy.validate("owner@mail.com", { email: "owner@mail.com" }),
    ).to.throw();
  });
});
