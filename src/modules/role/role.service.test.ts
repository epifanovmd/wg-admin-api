import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";
import { QueryFailedError } from "typeorm";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
} from "../../test/helpers";
import { definePermissions, unregisterPermissionDomain } from "../permission";
import { Permissions } from "../permission/permission.types";
import { RolePermissionsChangedEvent } from "./events";
import { RoleError } from "./role.errors";
import { RoleService } from "./role.service";
import { Roles } from "./role.types";

describe("RoleService", () => {
  let service: RoleService;
  let roleRepo: ReturnType<typeof createMockRepository>;
  let permissionRepo: ReturnType<typeof createMockRepository>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let sandbox: sinon.SinonSandbox;

  const superUser = {
    userId: uuid2(),
    sessionId: uuid2(),
    roles: [Roles.ADMIN],
    permissions: [Permissions.ALL],
    emailVerified: true,
  };
  const manager = {
    userId: uuid2(),
    sessionId: uuid2(),
    roles: ["manager"],
    permissions: [Permissions.ROLE_MANAGE],
    emailVerified: true,
  };

  const roleId = uuid();
  const permissionId = uuid2();

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    roleRepo = createMockRepository();
    permissionRepo = createMockRepository();

    (roleRepo as any).findAll = sinon.stub().resolves([]);
    (roleRepo as any).findById = sinon.stub().resolves(null);
    (roleRepo as any).findByName = sinon.stub().resolves(null);

    (roleRepo as any).ensureByName = sinon
      .stub()
      .callsFake(async (name: string) => ({
        id: `id-${name}`,
        name,
        permissions: [],
      }));
    (roleRepo as any).grantPermissionsIfMissing = sinon.stub().resolves();

    (permissionRepo as any).findByName = sinon.stub().resolves(null);
    (permissionRepo as any).ensureByName = sinon
      .stub()
      .callsFake(async (name: string) => ({ id: `perm-${name}`, name }));

    eventBus = createMockEventBus();
    service = new RoleService(
      roleRepo as any,
      permissionRepo as any,
      eventBus as any,
    );
  });

  afterEach(() => sandbox.restore());

  describe("getRoles", () => {
    it("should return list of roles", async () => {
      const roles = [
        { id: roleId, name: Roles.ADMIN, permissions: [] },
        { id: uuid2(), name: Roles.USER, permissions: [] },
      ];

      (roleRepo as any).findAll.resolves(roles);

      const result = await service.getRoles();

      expect(result).to.deep.equal(roles);
      expect((roleRepo as any).findAll.calledOnce).to.be.true;
    });
  });

  describe("setRolePermissions", () => {
    it("should replace role permissions and emit RolePermissionsChangedEvent", async () => {
      const role: any = { id: roleId, name: Roles.USER, permissions: [] };
      const updatedRole = {
        ...role,
        permissions: [{ id: permissionId, name: Permissions.USER_VIEW }],
      };

      (roleRepo as any).findById
        .onFirstCall()
        .resolves(role)
        .onSecondCall()
        .resolves(updatedRole);

      const result = await service.setRolePermissions(manager, roleId, [
        Permissions.USER_VIEW,
      ]);

      expect(roleRepo.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(updatedRole);

      const event = eventBus.emit.firstCall.args[0];

      expect(event).to.be.instanceOf(RolePermissionsChangedEvent);
      expect(event.roleId).to.equal(roleId);
      expect(event.permissions).to.deep.equal([Permissions.USER_VIEW]);
    });

    it("should create missing permissions", async () => {
      const role: any = { id: roleId, name: Roles.USER, permissions: [] };

      (roleRepo as any).findById.resolves(role);

      await service.setRolePermissions(superUser, roleId, ["report:export"]);

      expect(
        (permissionRepo as any).ensureByName.calledOnceWith("report:export"),
      ).to.be.true;
    });

    it("should forbid granting «*» to a non-superuser", async () => {
      (roleRepo as any).findById.resolves({
        id: roleId,
        name: Roles.USER,
        permissions: [],
      });

      try {
        await service.setRolePermissions(manager, roleId, [Permissions.ALL]);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.SUPERUSER_ONLY);
      }

      expect(roleRepo.save.called).to.be.false;
      expect(eventBus.emit.called).to.be.false;
    });

    it("should forbid changing the admin role to a non-superuser", async () => {
      (roleRepo as any).findById.resolves({
        id: roleId,
        name: Roles.ADMIN,
        permissions: [],
      });

      try {
        await service.setRolePermissions(manager, roleId, []);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.SUPERUSER_ONLY);
      }
    });

    it("should forbid changing the actor's own role", async () => {
      (roleRepo as any).findById.resolves({
        id: roleId,
        name: "manager",
        permissions: [],
      });

      try {
        await service.setRolePermissions(manager, roleId, [
          Permissions.USER_MANAGE,
        ]);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.OWN_ROLE);
        expect(err.status).to.equal(403);
      }
    });

    it("should throw NotFoundException when role is not found", async () => {
      (roleRepo as any).findById.resolves(null);

      try {
        await service.setRolePermissions(superUser, roleId, [
          Permissions.USER_VIEW,
        ]);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.NOT_FOUND);
        expect(err.status).to.equal(404);
      }
    });
  });

  describe("createRole", () => {
    it("создаёт новую роль", async () => {
      await service.createRole("moderator");

      expect(roleRepo.createAndSave.calledOnceWith({ name: "moderator" })).to.be
        .true;
    });

    it("существующая роль — 409", async () => {
      (roleRepo as any).findByName.resolves({ id: "r1", name: "moderator" });

      try {
        await service.createRole("moderator");
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.ALREADY_EXISTS);
        expect(err.status).to.equal(409);
      }
    });

    it("гонка двух созданий (unique violation) — 409", async () => {
      roleRepo.createAndSave.rejects(
        Object.assign(new QueryFailedError("INSERT", [], new Error("dup")), {
          driverError: { code: "23505" },
        }),
      );

      try {
        await service.createRole("moderator");
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal(RoleError.codes.ALREADY_EXISTS);
        expect(err.status).to.equal(409);
      }
    });
  });

  describe("seedDefaultPermissions", () => {
    it("should ensure every known permission exists", async () => {
      await service.seedDefaultPermissions();

      const seeded = (permissionRepo as any).ensureByName
        .getCalls()
        .map((c: any) => c.args[0]);

      for (const name of Object.values(Permissions)) {
        expect(seeded).to.include(name);
      }
    });

    it("засевает платформенные права apikey/audit", async () => {
      await service.seedDefaultPermissions();

      const seeded = (permissionRepo as any).ensureByName
        .getCalls()
        .map((c: any) => c.args[0]);

      expect(seeded).to.include.members(["apikey:manage", "audit:view"]);
    });

    it("засевает права, объявленные модулем через definePermissions", async () => {
      definePermissions("report", { EXPORT: "report:export" });

      try {
        await service.seedDefaultPermissions();
      } finally {
        unregisterPermissionDomain("report");
      }

      const seeded = (permissionRepo as any).ensureByName
        .getCalls()
        .map((c: any) => c.args[0]);

      expect(seeded).to.include("report:export");
    });

    it("should create default roles idempotently via ensureByName", async () => {
      await service.seedDefaultPermissions();

      const roles = (roleRepo as any).ensureByName
        .getCalls()
        .map((c: any) => c.args[0]);

      expect(roles).to.have.members([Roles.ADMIN, Roles.USER, Roles.GUEST]);
      expect(roleRepo.createAndSave.called).to.be.false;
    });

    const grantedTo = (roleName: string) =>
      (roleRepo as any).grantPermissionsIfMissing
        .getCalls()
        .find((c: any) => c.args[0] === `id-${roleName}`)?.args[1] as
        string[] | undefined;

    it("права ролей вставляются идемпотентно, без save (гонка реплик)", async () => {
      await service.seedDefaultPermissions();

      expect(roleRepo.save.called).to.be.false;
      expect((roleRepo as any).grantPermissionsIfMissing.called).to.be.true;
    });

    it("should not grant user:view / user:manage to USER by default", async () => {
      await service.seedDefaultPermissions();

      const ids = grantedTo(Roles.USER) ?? [];

      expect(ids).to.not.include(`perm-${Permissions.USER_VIEW}`);
      expect(ids).to.not.include(`perm-${Permissions.USER_MANAGE}`);
    });

    it("should grant «*» to ADMIN", async () => {
      await service.seedDefaultPermissions();

      expect(grantedTo(Roles.ADMIN)).to.deep.equal([`perm-${Permissions.ALL}`]);
    });

    it("should not overwrite existing role permissions", async () => {
      (roleRepo as any).ensureByName.callsFake(async (name: string) => ({
        id: `id-${name}`,
        name,
        permissions: [{ id: permissionId, name: Permissions.PROFILE_VIEW }],
      }));

      await service.seedDefaultPermissions();

      expect((roleRepo as any).grantPermissionsIfMissing.called).to.be.false;
    });
  });
});
