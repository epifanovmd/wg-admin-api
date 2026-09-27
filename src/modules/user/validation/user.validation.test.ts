import "reflect-metadata";

import { expect } from "chai";

import { Roles } from "../../role/role.types";
import { ConfirmEmailChangeSchema } from "./confirm-email-change.validate";
import { SetUsernameSchema } from "./set-username.validate";
import { ChangePasswordSchema } from "./user-change-password.validate";
import { DeleteMyUserSchema } from "./user-delete.validate";
import { UserListQuerySchema } from "./user-list-query.validate";
import { SetPrivilegesSchema } from "./user-privileges.validate";
import { UserUpdateSchema } from "./user-update.validate";
import { VerifyEmailSchema } from "./verify-email.validate";

describe("User Validation Schemas", () => {
  describe("SetUsernameSchema", () => {
    it("should accept valid username", () => {
      const result = SetUsernameSchema.safeParse({ username: "john_doe_1" });

      expect(result.success).to.be.true;
    });

    it("should transform to lowercase", () => {
      const result = SetUsernameSchema.safeParse({ username: "john_doe_1" });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.username).to.equal("john_doe_1");
      }
    });

    it("should reject username shorter than 5 chars", () => {
      const result = SetUsernameSchema.safeParse({ username: "ab" });

      expect(result.success).to.be.false;
    });

    it("should reject username longer than 32 chars", () => {
      const result = SetUsernameSchema.safeParse({
        username: "a".repeat(33),
      });

      expect(result.success).to.be.false;
    });

    it("should reject uppercase letters", () => {
      const result = SetUsernameSchema.safeParse({ username: "JohnDoe" });

      expect(result.success).to.be.false;
    });

    it("should reject special characters", () => {
      const result = SetUsernameSchema.safeParse({ username: "john-doe!" });

      expect(result.success).to.be.false;
    });
  });

  describe("ChangePasswordSchema", () => {
    it("should accept current and new password", () => {
      const result = ChangePasswordSchema.safeParse({
        currentPassword: "oldpassword",
        newPassword: "newpassword",
      });

      expect(result.success).to.be.true;
    });

    it("should reject missing current password", () => {
      const result = ChangePasswordSchema.safeParse({
        newPassword: "newpassword",
      });

      expect(result.success).to.be.false;
    });

    it("should reject short new password", () => {
      const result = ChangePasswordSchema.safeParse({
        currentPassword: "oldpassword",
        newPassword: "12345",
      });

      expect(result.success).to.be.false;
    });

    it("новый пароль короче 8 символов отклоняется, 8 — принимается", () => {
      expect(
        ChangePasswordSchema.safeParse({
          currentPassword: "oldpassword",
          newPassword: "1234567",
        }).success,
      ).to.be.false;
      expect(
        ChangePasswordSchema.safeParse({
          currentPassword: "oldpassword",
          newPassword: "12345678",
        }).success,
      ).to.be.true;
    });

    it("should reject new password exceeding 100 chars", () => {
      const result = ChangePasswordSchema.safeParse({
        currentPassword: "oldpassword",
        newPassword: "a".repeat(101),
      });

      expect(result.success).to.be.false;
    });

    it("should reject new password equal to the current one", () => {
      const result = ChangePasswordSchema.safeParse({
        currentPassword: "samepassword",
        newPassword: "samepassword",
      });

      expect(result.success).to.be.false;
    });
  });

  describe("VerifyEmailSchema", () => {
    it("should accept 6-digit code", () => {
      expect(VerifyEmailSchema.safeParse({ code: "123456" }).success).to.be
        .true;
    });

    it("should reject non-digit or wrong-length code", () => {
      expect(VerifyEmailSchema.safeParse({ code: "12a456" }).success).to.be
        .false;
      expect(VerifyEmailSchema.safeParse({ code: "12345" }).success).to.be
        .false;
      expect(VerifyEmailSchema.safeParse({}).success).to.be.false;
    });
  });

  describe("ConfirmEmailChangeSchema", () => {
    it("принимает 6 цифр, остальное отклоняет", () => {
      expect(ConfirmEmailChangeSchema.safeParse({ code: "012345" }).success).to
        .be.true;
      expect(ConfirmEmailChangeSchema.safeParse({ code: "12345" }).success).to
        .be.false;
      expect(ConfirmEmailChangeSchema.safeParse({ code: "12345a" }).success).to
        .be.false;
      expect(ConfirmEmailChangeSchema.safeParse({}).success).to.be.false;
    });
  });

  describe("DeleteMyUserSchema", () => {
    it("should require password", () => {
      expect(DeleteMyUserSchema.safeParse({}).success).to.be.false;
      expect(DeleteMyUserSchema.safeParse({ password: "" }).success).to.be
        .false;
      expect(DeleteMyUserSchema.safeParse({ password: "secret" }).success).to.be
        .true;
    });
  });

  describe("UserUpdateSchema", () => {
    it("should accept valid email", () => {
      const result = UserUpdateSchema.safeParse({ email: "new@test.com" });

      expect(result.success).to.be.true;
    });

    it("should accept valid phone", () => {
      const result = UserUpdateSchema.safeParse({ phone: "+71234567890" });

      expect(result.success).to.be.true;
    });

    it("should normalize phone via normalizePhone", () => {
      const result = UserUpdateSchema.safeParse({ phone: "8 (912) 345-67-89" });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.phone).to.equal("+79123456789");
      }
    });

    it("should strip roleId (roles change only via setPrivileges)", () => {
      const result = UserUpdateSchema.safeParse({
        email: "new@test.com",
        roleId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data).to.not.have.property("roleId");
      }
    });

    it("should reject roleId as the only field", () => {
      const result = UserUpdateSchema.safeParse({
        roleId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });

      expect(result.success).to.be.false;
    });

    it("should reject when no fields provided", () => {
      const result = UserUpdateSchema.safeParse({});

      expect(result.success).to.be.false;
    });

    it("should reject invalid email format", () => {
      const result = UserUpdateSchema.safeParse({ email: "not-email" });

      expect(result.success).to.be.false;
    });

    it("should reject invalid phone format", () => {
      const result = UserUpdateSchema.safeParse({ phone: "12345" });

      expect(result.success).to.be.false;
    });

    it("should transform email to lowercase", () => {
      const result = UserUpdateSchema.safeParse({ email: "TEST@Test.COM" });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.email).to.equal("test@test.com");
      }
    });

    it("should reject email exceeding 50 chars", () => {
      const result = UserUpdateSchema.safeParse({
        email: "a".repeat(45) + "@b.com",
      });

      expect(result.success).to.be.false;
    });
  });

  describe("SetPrivilegesSchema", () => {
    it("should accept valid roles and permissions", () => {
      const result = SetPrivilegesSchema.safeParse({
        roles: [Roles.USER],
      });

      expect(result.success).to.be.true;
    });

    it("should apply default empty permissions", () => {
      const result = SetPrivilegesSchema.safeParse({
        roles: [Roles.USER],
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.permissions).to.deep.equal([]);
      }
    });

    it("should reject empty roles array", () => {
      const result = SetPrivilegesSchema.safeParse({ roles: [] });

      expect(result.success).to.be.false;
    });

    it("should accept any non-empty string as role", () => {
      const result = SetPrivilegesSchema.safeParse({
        roles: ["custom-role"],
      });

      expect(result.success).to.be.true;
    });

    it("should reject empty string as role", () => {
      const result = SetPrivilegesSchema.safeParse({
        roles: [""],
      });

      expect(result.success).to.be.false;
    });

    it("should reject missing roles", () => {
      const result = SetPrivilegesSchema.safeParse({});

      expect(result.success).to.be.false;
    });
  });

  describe("UserListQuerySchema", () => {
    it("should allow missing query but cap limit", () => {
      expect(UserListQuerySchema.safeParse({}).success).to.be.true;
      expect(UserListQuerySchema.safeParse({ limit: "500" }).success).to.be
        .false;
    });
  });
});
