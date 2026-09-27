import { expect } from "chai";

import { validatePasswordPolicy } from "./password-policy";

describe("validatePasswordPolicy", () => {
  it("accepts a decent password", () => {
    expect(validatePasswordPolicy("Correct-Horse-42")).to.be.null;
  });

  it("requires at least 8 characters", () => {
    expect(validatePasswordPolicy("Ab1!xyz")).to.match(/минимум 8/);
  });

  it("rejects a password equal to the email or its local part", () => {
    expect(
      validatePasswordPolicy("John.Smith@Mail.com", {
        email: "john.smith@mail.com",
      }),
    ).to.match(/email/);
    expect(
      validatePasswordPolicy("john.smith", { email: "john.smith@mail.com" }),
    ).to.match(/email/);
  });

  it("rejects common passwords regardless of case", () => {
    expect(validatePasswordPolicy("Password123")).to.match(/простой/);
    expect(validatePasswordPolicy("qwertyuiop")).to.match(/простой/);
  });

  it("rejects overly long passwords", () => {
    expect(validatePasswordPolicy("a".repeat(101))).to.match(/превышать/);
  });

  it("rejects a password equal to the username", () => {
    expect(
      validatePasswordPolicy("Super_User_1", { username: "super_user_1" }),
    ).to.match(/именем/);
  });
});
