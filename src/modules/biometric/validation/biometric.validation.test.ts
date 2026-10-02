import { expect } from "chai";

import {
  RegisterBiometricSchema,
  VerifyBiometricSignatureSchema,
} from "./biometric.validate";

describe("Biometric validation", () => {
  describe("RegisterBiometricSchema", () => {
    const valid = {
      deviceId: "dev-1",
      deviceName: "iPhone",
      publicKey: "a2V5",
    };

    it("accepts valid data", () => {
      expect(RegisterBiometricSchema.safeParse(valid).success).to.be.true;
    });

    it("rejects a device name longer than 100", () => {
      expect(
        RegisterBiometricSchema.safeParse({
          ...valid,
          deviceName: "a".repeat(101),
        }).success,
      ).to.be.false;
    });

    it("rejects empty publicKey and deviceId", () => {
      expect(
        RegisterBiometricSchema.safeParse({ ...valid, publicKey: "" }).success,
      ).to.be.false;
      expect(
        RegisterBiometricSchema.safeParse({ ...valid, deviceId: " " }).success,
      ).to.be.false;
    });
  });

  describe("VerifyBiometricSignatureSchema", () => {
    it("requires userId, deviceId, nonce and signature", () => {
      expect(
        VerifyBiometricSignatureSchema.safeParse({
          userId: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
          deviceId: "dev-1",
          nonce: "n",
          signature: "s",
        }).success,
      ).to.be.true;
      expect(
        VerifyBiometricSignatureSchema.safeParse({
          userId: "not-a-uuid",
          deviceId: "dev-1",
          nonce: "n",
          signature: "s",
        }).success,
      ).to.be.false;
    });
  });
});
