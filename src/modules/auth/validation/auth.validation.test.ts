import "reflect-metadata";

import { expect } from "chai";

import { AuthenticateSchema } from "./auth-authenticate.validate";
import { RefreshSchema } from "./auth-refresh.validate";
import {
  RequestResetPasswordSchema,
  ResetPasswordSchema,
} from "./auth-reset-password.validate";
import { SignInSchema } from "./auth-sign-in.validate";
import { SignUpSchema } from "./auth-sign-up.validate";
import { Disable2FASchema } from "./disable-2fa.validate";
import { Enable2FASchema } from "./enable-2fa.validate";
import { Verify2FASchema } from "./verify-2fa.validate";

describe("Auth Validation Schemas", () => {
  describe("SignUpSchema", () => {
    it("should accept valid data with email", () => {
      const result = SignUpSchema.safeParse({
        email: "test@example.com",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
    });

    it("should accept valid data with phone", () => {
      const result = SignUpSchema.safeParse({
        phone: "+71234567890",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
    });

    it("should accept 8-format phone", () => {
      const result = SignUpSchema.safeParse({
        phone: "81234567890",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
    });

    it("should reject when neither email nor phone provided", () => {
      const result = SignUpSchema.safeParse({ password: "Correct-Horse-42" });

      expect(result.success).to.be.false;
    });

    it("should reject a common password", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "Password123",
      });

      expect(result.success).to.be.false;
    });

    it("should reject a password equal to the email", () => {
      const result = SignUpSchema.safeParse({
        email: "someone@b.com",
        password: "someone@b.com",
      });

      expect(result.success).to.be.false;
      expect(result.error?.issues[0].path).to.deep.equal(["password"]);
    });

    it("should reject a 7-character password", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "Abc-123",
      });

      expect(result.success).to.be.false;
    });

    it("should reject short password", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "12",
      });

      expect(result.success).to.be.false;
    });

    it("should reject password exceeding max length", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "a".repeat(101),
      });

      expect(result.success).to.be.false;
    });

    it("should reject invalid email format", () => {
      const result = SignUpSchema.safeParse({
        email: "not-an-email",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.false;
    });

    it("should normalize a phone with spaces and brackets", () => {
      const result = SignUpSchema.safeParse({
        phone: "8 (912) 345-67-89",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
      expect(result.data?.phone).to.equal("+79123456789");
    });

    it("should reject invalid phone format", () => {
      const result = SignUpSchema.safeParse({
        phone: "12345",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.false;
    });

    it("should transform email to lowercase", () => {
      const result = SignUpSchema.safeParse({
        email: "TEST@Example.COM",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.email).to.equal("test@example.com");
      }
    });

    it("should accept optional firstName and lastName", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "Correct-Horse-42",
        firstName: "John",
        lastName: "Doe",
      });

      expect(result.success).to.be.true;
    });

    it("should reject firstName exceeding 50 chars", () => {
      const result = SignUpSchema.safeParse({
        email: "a@b.com",
        password: "Correct-Horse-42",
        firstName: "a".repeat(51),
      });

      expect(result.success).to.be.false;
    });
  });

  describe("SignInSchema", () => {
    it("should accept valid data", () => {
      const result = SignInSchema.safeParse({
        login: "user@test.com",
        password: "123456",
      });

      expect(result.success).to.be.true;
    });

    it("should reject empty login", () => {
      const result = SignInSchema.safeParse({ login: "", password: "123456" });

      expect(result.success).to.be.false;
    });

    it("should reject short password", () => {
      const result = SignInSchema.safeParse({
        login: "user",
        password: "12345",
      });

      expect(result.success).to.be.false;
    });

    it("should reject missing login", () => {
      const result = SignInSchema.safeParse({ password: "123456" });

      expect(result.success).to.be.false;
    });

    it("should reject missing password", () => {
      const result = SignInSchema.safeParse({ login: "user" });

      expect(result.success).to.be.false;
    });

    it("should reject login exceeding 100 chars", () => {
      const result = SignInSchema.safeParse({
        login: "a".repeat(101),
        password: "123456",
      });

      expect(result.success).to.be.false;
    });
  });

  describe("RefreshSchema", () => {
    it("should accept valid refresh token", () => {
      const result = RefreshSchema.safeParse({
        refreshToken: "some-valid-token",
      });

      expect(result.success).to.be.true;
    });

    it("should reject empty refresh token", () => {
      const result = RefreshSchema.safeParse({ refreshToken: "" });

      expect(result.success).to.be.false;
    });

    it("should accept a missing refresh token (it may come in a cookie)", () => {
      const result = RefreshSchema.safeParse({});

      expect(result.success).to.be.true;
    });
  });

  describe("ResetPasswordSchema", () => {
    it("should accept valid data", () => {
      const result = ResetPasswordSchema.safeParse({
        token: "reset-token",
        password: "Correct-Horse-42",
      });

      expect(result.success).to.be.true;
    });

    it("should reject a common password", () => {
      const result = ResetPasswordSchema.safeParse({
        token: "reset-token",
        password: "qwertyuiop",
      });

      expect(result.success).to.be.false;
    });

    it("should reject empty token", () => {
      const result = ResetPasswordSchema.safeParse({
        token: "",
        password: "123456",
      });

      expect(result.success).to.be.false;
    });

    it("should reject short password", () => {
      const result = ResetPasswordSchema.safeParse({
        token: "token",
        password: "12",
      });

      expect(result.success).to.be.false;
    });
  });

  describe("RequestResetPasswordSchema", () => {
    it("should accept valid login", () => {
      const result = RequestResetPasswordSchema.safeParse({ login: "user" });

      expect(result.success).to.be.true;
    });

    it("should reject empty login", () => {
      const result = RequestResetPasswordSchema.safeParse({ login: "" });

      expect(result.success).to.be.false;
    });

    it("should reject login exceeding 100 chars", () => {
      const result = RequestResetPasswordSchema.safeParse({
        login: "a".repeat(101),
      });

      expect(result.success).to.be.false;
    });
  });

  describe("AuthenticateSchema", () => {
    it("should accept valid code", () => {
      const result = AuthenticateSchema.safeParse({ code: "123456" });

      expect(result.success).to.be.true;
    });

    it("should reject empty code", () => {
      const result = AuthenticateSchema.safeParse({ code: "" });

      expect(result.success).to.be.false;
    });

    it("should reject missing code", () => {
      const result = AuthenticateSchema.safeParse({});

      expect(result.success).to.be.false;
    });
  });

  describe("Enable2FASchema", () => {
    const valid = { currentPassword: "account-pass", password: "2fa-secret" };

    it("should accept valid data", () => {
      expect(Enable2FASchema.safeParse(valid).success).to.be.true;
    });

    it("should accept data with hint", () => {
      expect(Enable2FASchema.safeParse({ ...valid, hint: "my hint" }).success)
        .to.be.true;
    });

    it("should require the current account password", () => {
      expect(Enable2FASchema.safeParse({ password: "123456" }).success).to.be
        .false;
    });

    it("should reject a new 2FA password shorter than 8", () => {
      expect(
        Enable2FASchema.safeParse({ ...valid, password: "1234567" }).success,
      ).to.be.false;
    });

    it("should reject password exceeding 100 chars", () => {
      expect(
        Enable2FASchema.safeParse({ ...valid, password: "a".repeat(101) })
          .success,
      ).to.be.false;
    });

    it("should reject hint exceeding 100 chars", () => {
      expect(
        Enable2FASchema.safeParse({ ...valid, hint: "a".repeat(101) }).success,
      ).to.be.false;
    });
  });

  describe("Disable2FASchema", () => {
    it("should require both passwords", () => {
      expect(
        Disable2FASchema.safeParse({
          currentPassword: "account-pass",
          password: "123456",
        }).success,
      ).to.be.true;
      expect(Disable2FASchema.safeParse({ password: "123456" }).success).to.be
        .false;
    });
  });

  describe("Verify2FASchema", () => {
    it("should accept valid data", () => {
      const result = Verify2FASchema.safeParse({
        twoFactorToken: "token-123",
        password: "123456",
      });

      expect(result.success).to.be.true;
    });

    it("should reject empty token", () => {
      const result = Verify2FASchema.safeParse({
        twoFactorToken: "",
        password: "123456",
      });

      expect(result.success).to.be.false;
    });

    it("should reject a 2FA password shorter than 6", () => {
      const result = Verify2FASchema.safeParse({
        twoFactorToken: "token",
        password: "12345",
      });

      expect(result.success).to.be.false;
    });

    it("should reject missing fields", () => {
      const result = Verify2FASchema.safeParse({});

      expect(result.success).to.be.false;
    });
  });
});
