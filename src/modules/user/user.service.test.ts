import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";
import { QueryFailedError } from "typeorm";

import { hashPassword, verifyPassword } from "../../core/auth/password";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "../../core/http";
import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
  uuid3,
} from "../../test/helpers";
import { Permissions } from "../permission/permission.types";
import { Roles } from "../role/role.types";
import {
  EmailVerifiedEvent,
  PasswordChangedEvent,
  UserDeletedEvent,
  UserPrivilegesChangedEvent,
} from "./events";
import { escapeLike } from "./user.repository";
import { UserService } from "./user.service";

/** Ожидаемая ошибка: класс или доменный код (`USER_NOT_FOUND`). */
const expectReject = async (
  promise: Promise<unknown>,
  expected: string | (new (...args: any[]) => Error),
) => {
  try {
    await promise;
    expect.fail("Should have thrown");
  } catch (err: any) {
    if (typeof expected === "string") {
      expect(err.code).to.equal(expected);
    } else {
      expect(err).to.be.instanceOf(expected);
    }
  }
};

const uniqueViolation = () =>
  new QueryFailedError("INSERT", [], { code: "23505" } as any);

describe("UserService", () => {
  let service: UserService;
  let mockUserRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let mockRoleRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let mockPermissionRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let mockOtpRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let mockMailerService: any;
  let mockOtpService: any;
  let mockEmailChange: { request: sinon.SinonStub; confirm: sinon.SinonStub };
  let passwordPolicy: { validate: sinon.SinonStub };
  let eventBus: ReturnType<typeof createMockEventBus>;
  let txRepos: Record<string, any>;
  let sandbox: sinon.SinonSandbox;

  const userRole = {
    id: uuid2(),
    name: Roles.USER,
    permissions: [],
  };
  const adminRole = {
    id: uuid3(),
    name: Roles.ADMIN,
    permissions: [{ id: "p-all", name: Permissions.ALL }],
  };
  const fakeProfile = {
    id: uuid2(),
    userId: uuid(),
    firstName: "Test",
    lastName: "User",
  };
  const makeUser = (overrides: Record<string, any> = {}) => ({
    id: uuid(),
    email: "test@example.com",
    phone: "+71234567890",
    username: "testuser",
    passwordHash: "",
    emailVerified: false,
    twoFactorHash: null,
    twoFactorHint: null,
    roles: [userRole],
    directPermissions: [],
    profile: fakeProfile,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const manager = {
    userId: uuid3(),
    sessionId: "session-manager",
    roles: [Roles.USER],
    permissions: [Permissions.USER_MANAGE],
    emailVerified: true,
  };
  const superUser = {
    userId: uuid3(),
    sessionId: "session-admin",
    roles: [Roles.ADMIN],
    permissions: [Permissions.ALL],
    emailVerified: true,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockUserRepo = {
      ...createMockRepository(),
      findByEmailOrPhone: sandbox.stub().resolves(null),
      findById: sandbox.stub(),
      findConflicting: sandbox.stub().resolves(null),
      findByRoleId: sandbox.stub().resolves([]),
      updateWithResponse: sandbox.stub(),
      findByUsername: sandbox.stub(),
      searchByQuery: sandbox.stub(),
      findOptions: sandbox.stub(),
    } as any;

    mockRoleRepo = {
      ...createMockRepository(),
      findByName: sandbox.stub(),
      findByNames: sandbox.stub().resolves([]),
    } as any;

    mockPermissionRepo = {
      ...createMockRepository(),
      findByName: sandbox.stub(),
      findByNames: sandbox.stub().resolves([]),
    } as any;

    mockOtpRepo = {
      ...createMockRepository(),
      findByUserId: sandbox.stub().resolves(null),
    } as any;

    mockMailerService = {
      sendCodeMail: sandbox.stub().resolves(),
    };

    mockOtpService = {
      create: sandbox.stub().resolves({ code: "123456" }),
      check: sandbox.stub().resolves(true),
    };

    eventBus = createMockEventBus();

    mockEmailChange = {
      request: sandbox.stub().resolves(true),
      confirm: sandbox.stub().resolves(),
    };
    passwordPolicy = { validate: sandbox.stub().resolves() };

    txRepos = {
      User: {
        create: sinon.stub().callsFake((data: any) => ({ ...data })),
        save: sinon
          .stub()
          .callsFake((data: any) => Promise.resolve({ id: uuid(), ...data })),
      },
      Profile: {
        create: sinon.stub().callsFake((data: any) => ({ ...data })),
        save: sinon
          .stub()
          .callsFake((data: any) => Promise.resolve({ id: uuid2(), ...data })),
      },
      Role: {
        find: sinon.stub().resolves([userRole]),
      },
    };

    service = new UserService(
      mockMailerService,
      mockOtpService,
      mockOtpRepo as any,
      mockUserRepo as any,
      mockRoleRepo as any,
      mockPermissionRepo as any,
      {
        transaction: sinon.stub().callsFake((cb: any) =>
          cb({
            getRepository: (entity: { name: string }) => txRepos[entity.name],
          }),
        ),
      } as any,
      eventBus as any,
      mockEmailChange as any,
      [passwordPolicy],
    );
  });

  afterEach(() => sandbox.restore());

  describe("escapeLike", () => {
    it("should escape LIKE wildcards", () => {
      expect(escapeLike("50%_off\\")).to.equal("50\\%\\_off\\\\");
    });
  });

  describe("getUsers", () => {
    it("should escape wildcards in the email filter", async () => {
      mockUserRepo.findAndCount.resolves([[], 0]);

      await service.getUsers(0, 10, "a%b");

      const where = mockUserRepo.findAndCount.firstCall.args[0].where;

      expect(where[0].email.value).to.equal("%a\\%b%");
    });

    it("should pass undefined where when no query provided", async () => {
      mockUserRepo.findAndCount.resolves([[], 0]);

      await service.getUsers(0, 10);

      expect(mockUserRepo.findAndCount.firstCall.args[0].where).to.be.undefined;
    });

    it("возвращает IPaginatedDto с UserDto и ограничивает limit", async () => {
      mockUserRepo.findAndCount.resolves([[makeUser({ roles: [] })], 41]);

      const page = await service.getUsers(40, 1000);

      const options = mockUserRepo.findAndCount.firstCall.args[0];

      expect(options.skip).to.equal(40);
      expect(options.take).to.equal(100);
      expect(page.total).to.equal(41);
      expect(page.offset).to.equal(40);
      expect(page.limit).to.equal(100);
      expect(page.items[0].email).to.equal("test@example.com");
      expect(page.items[0]).to.not.have.property("passwordHash");
    });
  });

  describe("getUserByAttr", () => {
    it("should throw NotFoundException when user not found", async () => {
      await expectReject(
        service.getUserByAttr({ email: "none@example.com" }),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("createUser", () => {
    it("should assign USER role in the same transaction", async () => {
      mockUserRepo.findOne.resolves(makeUser());

      await service.createUser({ email: "new@example.com" });

      const savedUser = txRepos.User.save.firstCall.args[0];

      expect(savedUser.roles).to.deep.equal([userRole]);
      expect(txRepos.Profile.save.calledOnce).to.be.true;
      expect(mockUserRepo.save.called).to.be.false;
      expect(eventBus.emit.called).to.be.false;
    });

    it("should fail when a default role is missing", async () => {
      txRepos.Role.find.resolves([]);

      await expectReject(
        service.createUser({ email: "new@example.com" }),
        "USER_DEFAULT_ROLE_MISSING",
      );
      expect(txRepos.User.save.called).to.be.false;
    });

    it("should map unique violation to ConflictException", async () => {
      txRepos.User.save.rejects(uniqueViolation());

      await expectReject(
        service.createUser({ email: "dup@example.com" }),
        "USER_ALREADY_EXISTS",
      );
    });
  });

  describe("createAdmin", () => {
    it("should throw ConflictException if user already exists", async () => {
      mockUserRepo.findByEmailOrPhone.resolves(makeUser());

      await expectReject(
        service.createAdmin({ email: "test@example.com" }),
        "USER_ALREADY_EXISTS",
      );
    });

    it("should create admin with the ADMIN role only", async () => {
      txRepos.Role.find.resolves([adminRole]);
      mockUserRepo.findOne.resolves(makeUser({ roles: [adminRole] }));

      await service.createAdmin({ email: "admin@example.com" });

      const roleQuery = txRepos.Role.find.firstCall.args[0];

      expect(roleQuery.where.name.value).to.deep.equal([Roles.ADMIN]);
    });
  });

  describe("updateUser", () => {
    it("should reset emailVerified and send OTP to the new email", async () => {
      mockUserRepo.findById.resolves(makeUser({ emailVerified: true }));
      mockUserRepo.findOne.resolves(makeUser({ email: "new@example.com" }));

      await service.updateUser(uuid(), { email: "new@example.com" });

      const [, patch] = mockUserRepo.update.firstCall.args;

      expect(patch).to.deep.equal({
        email: "new@example.com",
        emailVerified: false,
      });
      expect(mockOtpService.create.calledOnceWith(uuid())).to.be.true;
      expect(
        mockMailerService.sendCodeMail.calledOnceWith(
          "new@example.com",
          "123456",
        ),
      ).to.be.true;
    });

    it("should not touch emailVerified when email is unchanged", async () => {
      mockUserRepo.findById.resolves(makeUser({ emailVerified: true }));
      mockUserRepo.findOne.resolves(makeUser());

      await service.updateUser(uuid(), {
        email: "test@example.com",
        phone: "89001234567",
      });

      const [, patch] = mockUserRepo.update.firstCall.args;

      expect(patch).to.deep.equal({ phone: "+79001234567" });
      expect(mockOtpService.create.called).to.be.false;
    });

    it("should reject email taken by another user with 409", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.findConflicting.resolves(makeUser({ id: uuid2() }));

      await expectReject(
        service.updateUser(uuid(), { email: "taken@example.com" }),
        "USER_EMAIL_TAKEN",
      );
      expect(mockUserRepo.update.called).to.be.false;
    });

    it("should map PG unique violation (race) to 409", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.update.rejects(uniqueViolation());

      await expectReject(
        service.updateUser(uuid(), { phone: "+79001234567" }),
        "USER_PHONE_TAKEN",
      );
    });

    it("should ignore roleId even if it slips through", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.findOne.resolves(makeUser());

      await service.updateUser(uuid(), {
        phone: "+79001234567",
        roleId: uuid2(),
      } as any);

      const [, patch] = mockUserRepo.update.firstCall.args;

      expect(patch).to.not.have.property("roleId");
    });

    it("should throw NotFoundException when user not found", async () => {
      mockUserRepo.findById.resolves(null);

      await expectReject(
        service.updateUser(uuid(), { email: "x@example.com" }),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("updateMyUser", () => {
    it("новый email не меняется сразу — создаётся запрос на смену", async () => {
      mockUserRepo.findById.resolves(makeUser({ emailVerified: true }));
      mockUserRepo.findOne.resolves(makeUser());

      await service.updateMyUser(uuid(), { email: "new@example.com" });

      expect(mockEmailChange.request.calledOnceWith(uuid(), "new@example.com"))
        .to.be.true;
      expect(mockUserRepo.update.called).to.be.false;
      expect(mockOtpService.create.called).to.be.false;
    });

    it("телефон меняется сразу", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.findOne.resolves(makeUser());

      await service.updateMyUser(uuid(), { phone: "89001234567" });

      expect(
        mockUserRepo.update.calledOnceWith(uuid(), { phone: "+79001234567" }),
      ).to.be.true;
      expect(mockEmailChange.request.called).to.be.false;
    });

    it("занятый телефон — 409 до запроса смены email", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.findConflicting.resolves(
        makeUser({ id: uuid2(), phone: "+79001234567" }),
      );

      await expectReject(
        service.updateMyUser(uuid(), {
          email: "new@example.com",
          phone: "+79001234567",
        }),
        "USER_PHONE_TAKEN",
      );
      expect(mockEmailChange.request.called).to.be.false;
      expect(mockUserRepo.update.called).to.be.false;
    });

    it("ошибка запроса смены email — телефон не сохраняется", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockEmailChange.request.rejects(
        Object.assign(new Error("taken"), { code: "USER_EMAIL_TAKEN" }),
      );

      await expectReject(
        service.updateMyUser(uuid(), {
          email: "taken@example.com",
          phone: "+79001234567",
        }),
        "USER_EMAIL_TAKEN",
      );
      expect(mockUserRepo.update.called).to.be.false;
    });

    it("пользователь не найден — USER_NOT_FOUND", async () => {
      mockUserRepo.findById.resolves(null);

      await expectReject(
        service.updateMyUser(uuid(), { email: "x@example.com" }),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("confirmEmailChange", () => {
    it("делегирует подтверждение и возвращает пользователя", async () => {
      mockUserRepo.findOne.resolves(makeUser({ email: "new@example.com" }));

      const user = await service.confirmEmailChange(uuid(), "123456");

      expect(mockEmailChange.confirm.calledOnceWith(uuid(), "123456")).to.be
        .true;
      expect(user.email).to.equal("new@example.com");
    });
  });

  describe("setPrivileges", () => {
    beforeEach(() => {
      mockUserRepo.findById.resolves(
        makeUser({ roles: [], directPermissions: [] }),
      );
      mockUserRepo.findOne.resolves(makeUser());
    });

    it("should assign existing roles and permissions and emit event", async () => {
      mockRoleRepo.findByNames.resolves([userRole]);
      mockPermissionRepo.findByNames.resolves([
        { id: "p1", name: Permissions.PROFILE_VIEW },
      ]);

      await service.setPrivileges(manager, uuid(), {
        roles: [Roles.USER],
        permissions: [Permissions.PROFILE_VIEW],
      });

      const saved = mockUserRepo.save.firstCall.args[0];

      expect(saved.roles).to.deep.equal([userRole]);
      expect(saved.directPermissions.map((p: any) => p.name)).to.deep.equal([
        Permissions.PROFILE_VIEW,
      ]);

      const event = eventBus.emitAsync.firstCall.args[0];

      expect(event).to.be.instanceOf(UserPrivilegesChangedEvent);
      expect(event.userId).to.equal(uuid());
    });

    it("should not create unknown roles", async () => {
      mockRoleRepo.findByNames.resolves([]);

      await expectReject(
        service.setPrivileges(superUser, uuid(), {
          roles: ["ghost"],
          permissions: [],
        }),
        "USER_ROLES_NOT_FOUND",
      );
      expect(mockRoleRepo.createAndSave.called).to.be.false;
      expect(mockUserRepo.save.called).to.be.false;
    });

    it("should not create unknown permissions", async () => {
      mockRoleRepo.findByNames.resolves([userRole]);
      mockPermissionRepo.findByNames.resolves([]);

      await expectReject(
        service.setPrivileges(superUser, uuid(), {
          roles: [Roles.USER],
          permissions: ["made:up"],
        }),
        "USER_PERMISSIONS_NOT_FOUND",
      );
      expect(mockPermissionRepo.createAndSave.called).to.be.false;
    });

    it("should forbid granting admin role to a non-superuser", async () => {
      mockRoleRepo.findByNames.resolves([adminRole]);

      await expectReject(
        service.setPrivileges(manager, uuid(), {
          roles: [Roles.ADMIN],
          permissions: [],
        }),
        "USER_SUPERUSER_ONLY",
      );
    });

    it("should forbid granting «*» to a non-superuser", async () => {
      mockRoleRepo.findByNames.resolves([userRole]);
      mockPermissionRepo.findByNames.resolves([
        { id: "p-all", name: Permissions.ALL },
      ]);

      await expectReject(
        service.setPrivileges(manager, uuid(), {
          roles: [Roles.USER],
          permissions: [Permissions.ALL],
        }),
        "USER_SUPERUSER_ONLY",
      );
    });

    it("should forbid a non-superuser changing a superuser", async () => {
      mockUserRepo.findById.resolves(makeUser({ roles: [adminRole] }));
      mockRoleRepo.findByNames.resolves([userRole]);

      await expectReject(
        service.setPrivileges(manager, uuid(), {
          roles: [Roles.USER],
          permissions: [],
        }),
        "USER_SUPERUSER_ONLY",
      );
    });

    it("should allow superuser to grant admin", async () => {
      mockRoleRepo.findByNames.resolves([adminRole]);

      await service.setPrivileges(superUser, uuid(), {
        roles: [Roles.ADMIN],
        permissions: [],
      });

      expect(mockUserRepo.save.calledOnce).to.be.true;
    });

    it("should forbid changing own privileges", async () => {
      await expectReject(
        service.setPrivileges(superUser, superUser.userId, {
          roles: [Roles.USER],
          permissions: [],
        }),
        "USER_OWN_PRIVILEGES",
      );
      expect(mockUserRepo.save.called).to.be.false;
    });

    it("should throw NotFoundException when user not found", async () => {
      mockUserRepo.findById.resolves(null);

      await expectReject(
        service.setPrivileges(superUser, uuid(), {
          roles: [Roles.USER],
          permissions: [],
        }),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("notifyRoleMembersPrivilegesChanged", () => {
    it("should emit UserPrivilegesChangedEvent for every role member", async () => {
      mockUserRepo.findByRoleId.resolves([
        makeUser({ id: "u1", roles: [userRole] }),
        makeUser({ id: "u2", roles: [userRole] }),
      ]);

      await service.notifyRoleMembersPrivilegesChanged(userRole.id);

      const events = eventBus.emitAsync.getCalls().map(c => c.args[0]);

      expect(events.map(e => e.userId)).to.deep.equal(["u1", "u2"]);
      expect(events[0]).to.be.instanceOf(UserPrivilegesChangedEvent);
    });
  });

  describe("requestVerifyEmail", () => {
    it("should send OTP code to user email", async () => {
      mockUserRepo.findOne.resolves(makeUser());

      await service.requestVerifyEmail(uuid());

      expect(
        mockMailerService.sendCodeMail.calledWith("test@example.com", "123456"),
      ).to.be.true;
    });

    it("письмо не ушло — код отзывается, повторный запрос не блокируется", async () => {
      mockUserRepo.findOne.resolves(makeUser());
      mockMailerService.sendCodeMail.rejects(
        new ServiceUnavailableException("Почтовый сервис недоступен"),
      );

      await expectReject(
        service.requestVerifyEmail(uuid()),
        ServiceUnavailableException,
      );
      expect(mockOtpRepo.delete.calledWithMatch({ userId: uuid() })).to.be.true;
    });

    it("should enforce resend cooldown", async () => {
      mockUserRepo.findOne.resolves(makeUser());
      mockOtpRepo.findByUserId.resolves({ updatedAt: new Date() });

      await expectReject(
        service.requestVerifyEmail(uuid()),
        "USER_VERIFY_EMAIL_TOO_FREQUENT",
      );
      expect(mockOtpService.create.called).to.be.false;
    });

    it("should allow resend after cooldown", async () => {
      mockUserRepo.findOne.resolves(makeUser());
      mockOtpRepo.findByUserId.resolves({
        updatedAt: new Date(Date.now() - 10 * 60_000),
      });

      await service.requestVerifyEmail(uuid());

      expect(mockOtpService.create.calledOnce).to.be.true;
    });

    it("should throw ConflictException if email already verified", async () => {
      mockUserRepo.findOne.resolves(makeUser({ emailVerified: true }));

      await expectReject(
        service.requestVerifyEmail(uuid()),
        "USER_EMAIL_ALREADY_VERIFIED",
      );
    });

    it("should throw when user has no email", async () => {
      mockUserRepo.findOne.resolves(makeUser({ email: null }));

      await expectReject(
        service.requestVerifyEmail(uuid()),
        "USER_EMAIL_MISSING",
      );
    });
  });

  describe("verifyEmail", () => {
    it("should verify email with valid OTP code", async () => {
      mockUserRepo.findOne.resolves(makeUser());

      await service.verifyEmail(uuid(), "123456");

      expect(
        mockUserRepo.update.calledOnceWith(uuid(), { emailVerified: true }),
      ).to.be.true;
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        EmailVerifiedEvent,
      );
    });

    it("should propagate OTP check errors without updating", async () => {
      mockUserRepo.findOne.resolves(makeUser());
      mockOtpService.check.rejects(new BadRequestException("bad code"));

      await expectReject(
        service.verifyEmail(uuid(), "000000"),
        BadRequestException,
      );
      expect(mockUserRepo.update.called).to.be.false;
    });

    it("should throw ConflictException if email already verified", async () => {
      mockUserRepo.findOne.resolves(makeUser({ emailVerified: true }));

      await expectReject(
        service.verifyEmail(uuid(), "123456"),
        "USER_EMAIL_ALREADY_VERIFIED",
      );
    });
  });

  describe("changeOwnPassword", () => {
    it("should verify current password, store scrypt hash and emit event once", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("old-password") }),
      );

      await service.changeOwnPassword(uuid(), "session-1", {
        currentPassword: "old-password",
        newPassword: "new-password",
      });

      const [, patch] = mockUserRepo.update.firstCall.args;

      expect(patch.passwordHash).to.match(/^scrypt\$/);
      expect(await verifyPassword("new-password", patch.passwordHash)).to.be
        .true;

      expect(eventBus.emitAsync.callCount).to.equal(1);

      const event = eventBus.emitAsync.firstCall.args[0];

      expect(event).to.be.instanceOf(PasswordChangedEvent);
      expect(event.method).to.equal("change");
      expect(event.currentSessionId).to.equal("session-1");
    });

    it("should reject wrong current password", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("old-password") }),
      );

      await expectReject(
        service.changeOwnPassword(uuid(), "session-1", {
          currentPassword: "wrong",
          newPassword: "new-password",
        }),
        "USER_WRONG_CURRENT_PASSWORD",
      );
      expect(mockUserRepo.update.called).to.be.false;
      expect(eventBus.emitAsync.called).to.be.false;
    });
  });

  describe("changeOwnPassword — политика пароля", () => {
    it("новый пароль проверяется политиками с контекстом пользователя", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("old-password") }),
      );

      await service.changeOwnPassword(uuid(), "session-1", {
        currentPassword: "old-password",
        newPassword: "new-password",
      });

      expect(
        passwordPolicy.validate.calledOnceWith("new-password", {
          userId: uuid(),
          email: "test@example.com",
          username: "testuser",
        }),
      ).to.be.true;
    });

    it("отказ политики — пароль не меняется, события нет", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("old-password") }),
      );
      passwordPolicy.validate.rejects(
        Object.assign(new Error("weak"), { code: "VALIDATION_ERROR" }),
      );

      await expectReject(
        service.changeOwnPassword(uuid(), "session-1", {
          currentPassword: "old-password",
          newPassword: "password",
        }),
        "VALIDATION_ERROR",
      );
      expect(mockUserRepo.update.called).to.be.false;
      expect(eventBus.emitAsync.called).to.be.false;
    });

    it("без зарегистрированных политик пароль меняется", async () => {
      const bare = new UserService(
        mockMailerService,
        mockOtpService,
        mockOtpRepo as any,
        mockUserRepo as any,
        mockRoleRepo as any,
        mockPermissionRepo as any,
        {} as any,
        eventBus as any,
        mockEmailChange as any,
        undefined,
      );

      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("old-password") }),
      );

      await bare.changeOwnPassword(uuid(), "session-1", {
        currentPassword: "old-password",
        newPassword: "new-password",
      });

      expect(mockUserRepo.update.calledOnce).to.be.true;
    });
  });

  describe("changePassword (reset flow)", () => {
    it("should store scrypt hash without emitting events", async () => {
      await service.changePassword(uuid(), "new-password");

      const [, patch] = mockUserRepo.update.firstCall.args;

      expect(patch.passwordHash).to.match(/^scrypt\$/);
      expect(eventBus.emit.called).to.be.false;
    });
  });

  describe("deleteMyUser", () => {
    it("should delete after password check and emit event after delete", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("secret") }),
      );

      await service.deleteMyUser(uuid(), "secret");

      expect(mockUserRepo.delete.calledOnceWith(uuid())).to.be.true;
      expect(eventBus.emitAsync.firstCall.args[0]).to.be.instanceOf(
        UserDeletedEvent,
      );
      expect(mockUserRepo.delete.calledBefore(eventBus.emitAsync)).to.be.true;
    });

    it("should reject wrong password", async () => {
      mockUserRepo.findById.resolves(
        makeUser({ passwordHash: await hashPassword("secret") }),
      );

      await expectReject(
        service.deleteMyUser(uuid(), "nope"),
        "USER_WRONG_PASSWORD",
      );
      expect(mockUserRepo.delete.called).to.be.false;
    });
  });

  describe("deleteUserByAdmin", () => {
    it("should delete another user and emit event", async () => {
      mockUserRepo.findById.resolves(makeUser());

      await service.deleteUserByAdmin(manager, uuid());

      expect(mockUserRepo.delete.calledOnceWith(uuid())).to.be.true;
      expect(eventBus.emitAsync.firstCall.args[0]).to.be.instanceOf(
        UserDeletedEvent,
      );
    });

    it("should not emit event when nothing was deleted", async () => {
      mockUserRepo.findById.resolves(makeUser());
      mockUserRepo.delete.resolves({ affected: 0 });

      await expectReject(
        service.deleteUserByAdmin(manager, uuid()),
        "USER_NOT_FOUND",
      );
      expect(eventBus.emitAsync.called).to.be.false;
    });

    it("should forbid deleting self", async () => {
      await expectReject(
        service.deleteUserByAdmin(manager, manager.userId),
        "USER_SELF_DELETE_VIA_ADMIN",
      );
      expect(mockUserRepo.delete.called).to.be.false;
    });

    it("should forbid deleting a superuser", async () => {
      mockUserRepo.findById.resolves(makeUser({ roles: [adminRole] }));

      await expectReject(
        service.deleteUserByAdmin(superUser, uuid()),
        "USER_SUPERUSER_DELETE",
      );
      expect(mockUserRepo.delete.called).to.be.false;
    });

    it("should throw NotFoundException for missing user", async () => {
      mockUserRepo.findById.resolves(null);

      await expectReject(
        service.deleteUserByAdmin(manager, uuid()),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("setUsername", () => {
    it("should save valid username", async () => {
      mockUserRepo.findByUsername.resolves(null);
      mockUserRepo.findOne.resolves(makeUser({ username: "newuser" }));

      const result = await service.setUsername(uuid(), "newuser");

      expect(result).to.exist;
      expect(mockUserRepo.update.calledOnce).to.be.true;
    });

    it("should throw ConflictException for duplicate username", async () => {
      mockUserRepo.findByUsername.resolves({ id: uuid2() });

      await expectReject(
        service.setUsername(uuid(), "taken_name"),
        "USER_USERNAME_TAKEN",
      );
    });
  });
});
