import "reflect-metadata";

import { expect } from "chai";

import { UserDto } from "./user.dto";

const createUserEntity = (overrides: Record<string, any> = {}) =>
  ({
    id: "user-1",
    email: "test@example.com",
    emailVerified: true,
    phone: "+1234567890",
    username: "testuser",
    profile: null,
    roles: [],
    directPermissions: [],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-02"),
    ...overrides,
  }) as any;

describe("UserDto", () => {
  it("basic fields mapped correctly", () => {
    const entity = createUserEntity();
    const dto = UserDto.fromEntity(entity);

    expect(dto.id).to.equal("user-1");
    expect(dto.email).to.equal("test@example.com");
    expect(dto.emailVerified).to.be.true;
    expect(dto.phone).to.equal("+1234567890");
    expect(dto.username).to.equal("testuser");
    expect(dto.createdAt).to.deep.equal(new Date("2025-01-01"));
    expect(dto.updatedAt).to.deep.equal(new Date("2025-01-02"));
  });

  it("roles mapped via toDTO()", () => {
    const entity = createUserEntity({
      roles: [
        { toDTO: () => ({ id: "r1", name: "ADMIN" }) },
        { toDTO: () => ({ id: "r2", name: "USER" }) },
      ],
    });
    const dto = UserDto.fromEntity(entity);

    expect(dto.roles).to.deep.equal([
      { id: "r1", name: "ADMIN" },
      { id: "r2", name: "USER" },
    ]);
  });

  it("directPermissions mapped via toDTO()", () => {
    const entity = createUserEntity({
      directPermissions: [
        { toDTO: () => ({ id: "p1", slug: "wg:server:view" }) },
      ],
    });
    const dto = UserDto.fromEntity(entity);

    expect(dto.directPermissions).to.deep.equal([
      { id: "p1", slug: "wg:server:view" },
    ]);
  });

  it("null roles returns empty array", () => {
    const entity = createUserEntity({ roles: null });
    const dto = UserDto.fromEntity(entity);

    expect(dto.roles).to.deep.equal([]);
  });

  it("undefined roles returns empty array", () => {
    const entity = createUserEntity({ roles: undefined });
    const dto = UserDto.fromEntity(entity);

    expect(dto.roles).to.deep.equal([]);
  });

  it("null directPermissions returns empty array", () => {
    const entity = createUserEntity({ directPermissions: null });
    const dto = UserDto.fromEntity(entity);

    expect(dto.directPermissions).to.deep.equal([]);
  });

  it("profile mapped when present", () => {
    const entity = createUserEntity({
      profile: {
        id: "prof-1",
        userId: "user-1",
        firstName: "John",
        lastName: "Doe",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
      },
    });
    const dto = UserDto.fromEntity(entity);

    expect(dto.profile).to.not.be.undefined;
    expect(dto.profile!.firstName).to.equal("John");
  });
});
