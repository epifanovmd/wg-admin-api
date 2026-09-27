import "reflect-metadata";

import { expect } from "chai";

import { ProfileListQuerySchema } from "./profile-list-query.validate";
import { UpdateProfileSchema } from "./update-profile.validate";

describe("UpdateProfileSchema", () => {
  it("should accept valid profile data", () => {
    const result = UpdateProfileSchema.safeParse({
      firstName: "Иван",
      lastName: "Петров",
      gender: "male",
      birthDate: "1990-05-01",
    });

    expect(result.success).to.be.true;
  });

  it("should allow clearing fields with null", () => {
    const result = UpdateProfileSchema.safeParse({
      firstName: null,
      birthDate: null,
    });

    expect(result.success).to.be.true;
  });

  it("should reject names longer than 40 chars", () => {
    expect(UpdateProfileSchema.safeParse({ firstName: "a".repeat(41) }).success)
      .to.be.false;
    expect(UpdateProfileSchema.safeParse({ lastName: "a".repeat(41) }).success)
      .to.be.false;
  });

  it("should reject gender longer than 20 chars", () => {
    expect(UpdateProfileSchema.safeParse({ gender: "a".repeat(21) }).success).to
      .be.false;
  });

  it("should reject birthDate in the future", () => {
    const future = new Date(Date.now() + 86_400_000 * 2)
      .toISOString()
      .slice(0, 10);

    expect(UpdateProfileSchema.safeParse({ birthDate: future }).success).to.be
      .false;
  });

  it("should reject birthDate before 1900", () => {
    expect(UpdateProfileSchema.safeParse({ birthDate: "1899-12-31" }).success)
      .to.be.false;
  });

  it("should reject invalid date", () => {
    expect(UpdateProfileSchema.safeParse({ birthDate: "not-a-date" }).success)
      .to.be.false;
  });

  it("принимает locale кодом языка и null", () => {
    for (const locale of ["ru", "en", "en-US", "pt_BR", null]) {
      expect(UpdateProfileSchema.safeParse({ locale }).success, String(locale))
        .to.be.true;
    }
  });

  it("отклоняет locale не кодом языка и длиннее 10 символов", () => {
    for (const locale of ["русский", "e", "en-US-extra", "a".repeat(11)]) {
      expect(UpdateProfileSchema.safeParse({ locale }).success, locale).to.be
        .false;
    }
  });
});

describe("ProfileListQuerySchema", () => {
  it("приводит limit/offset из строк и ограничивает limit", () => {
    const ok = ProfileListQuerySchema.safeParse({ limit: "10", offset: "5" });

    expect(ok.success).to.be.true;
    expect(ok.data).to.deep.equal({ limit: 10, offset: 5 });
    expect(ProfileListQuerySchema.safeParse({ limit: "101" }).success).to.be
      .false;
    expect(ProfileListQuerySchema.safeParse({ offset: "-1" }).success).to.be
      .false;
  });
});
