import "reflect-metadata";

import bcrypt from "bcrypt";
import { expect } from "chai";

import { hashPassword, isLegacyHash, verifyPassword } from "./password";

describe("password", () => {
  it("hashes with scrypt and verifies the same password", async () => {
    const hash = await hashPassword("secret-123");

    expect(hash.startsWith("scrypt$")).to.equal(true);
    expect(await verifyPassword("secret-123", hash)).to.equal(true);
    expect(await verifyPassword("secret-124", hash)).to.equal(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("x")).to.not.equal(await hashPassword("x"));
  });

  it("rejects malformed hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).to.equal(false);
    expect(await verifyPassword("x", "scrypt$abc$salt")).to.equal(false);
  });

  it("still verifies legacy bcrypt hashes", async () => {
    const legacy = await bcrypt.hash("old-pass", 4);

    expect(isLegacyHash(legacy)).to.equal(true);
    expect(await verifyPassword("old-pass", legacy)).to.equal(true);
    expect(await verifyPassword("other", legacy)).to.equal(false);
  });
});
