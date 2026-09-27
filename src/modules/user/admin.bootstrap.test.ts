import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { ConflictException } from "../../core/http";
import { AdminBootstrap } from "./admin.bootstrap";
import { UserError } from "./user.errors";

describe("AdminBootstrap", () => {
  let userService: { createAdmin: sinon.SinonStub };
  let userRepo: { findByEmailOrPhone: sinon.SinonStub };
  let roleService: { seedDefaultPermissions: sinon.SinonStub };
  let bootstrap: AdminBootstrap;

  beforeEach(() => {
    userService = { createAdmin: sinon.stub().resolves({ id: "admin" }) };
    userRepo = { findByEmailOrPhone: sinon.stub().resolves(null) };
    roleService = { seedDefaultPermissions: sinon.stub().resolves() };
    bootstrap = new AdminBootstrap(
      userService as any,
      userRepo as any,
      roleService as any,
    );
  });

  it("should seed roles before creating the admin", async () => {
    await bootstrap.initialize();

    expect(
      roleService.seedDefaultPermissions.calledBefore(userService.createAdmin),
    ).to.be.true;

    const body = userService.createAdmin.firstCall.args[0];

    expect(body.passwordHash).to.match(/^scrypt\$/);
  });

  it("should skip creation when admin already exists", async () => {
    userRepo.findByEmailOrPhone.resolves({ id: "admin" });

    await bootstrap.initialize();

    expect(userService.createAdmin.called).to.be.false;
  });

  it("should treat a concurrent creation (409) as success", async () => {
    userService.createAdmin.rejects(new ConflictException("exists"));

    await bootstrap.initialize();
  });

  it("параллельное создание (USER_ALREADY_EXISTS) — не ошибка", async () => {
    userService.createAdmin.rejects(UserError.ALREADY_EXISTS());

    await bootstrap.initialize();
  });

  it("should not swallow other database errors", async () => {
    const dbError = new Error("connection refused");

    userService.createAdmin.rejects(dbError);

    try {
      await bootstrap.initialize();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).to.equal(dbError);
    }
  });
});
