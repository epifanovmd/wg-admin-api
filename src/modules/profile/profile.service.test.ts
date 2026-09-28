import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
} from "../../test/helpers";
import { ProfileService } from "./profile.service";

describe("ProfileService", () => {
  let service: ProfileService;
  let mockProfileRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let sandbox: sinon.SinonSandbox;
  let access: { isSuperUser: sinon.SinonStub };

  const actor = {
    userId: uuid2(),
    sessionId: "s",
    roles: ["user"],
    permissions: ["profile:update", "profile:delete"],
    emailVerified: true,
  };

  const fakeProfile = {
    id: uuid2(),
    userId: uuid(),
    firstName: "Test",
    lastName: "User",
    status: "offline",
    user: { id: uuid(), email: "test@example.com" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockProfileRepo = {
      ...createMockRepository(),
      findById: sandbox.stub(),
      findByUserId: sandbox.stub(),
    } as any;

    access = { isSuperUser: sandbox.stub().resolves(false) };
    service = new ProfileService(
      mockProfileRepo as any,
      createMockEventBus() as any,
      access as any,
    );
  });

  afterEach(() => sandbox.restore());

  describe("getProfiles", () => {
    it("возвращает страницу IPaginatedDto с публичными профилями", async () => {
      mockProfileRepo.findPage = sandbox.stub().resolves([[fakeProfile], 1]);

      const result = await service.getProfiles(0, 10);

      expect(mockProfileRepo.findPage.calledOnceWith({ offset: 0, limit: 10 }))
        .to.be.true;
      expect(result.total).to.equal(1);
      expect(result.offset).to.equal(0);
      expect(result.limit).to.equal(10);
      expect(result.items).to.have.lengthOf(1);
      expect(result.items[0].userId).to.equal(fakeProfile.userId);
      expect(result.items[0]).to.not.have.property("user");
    });

    it("без параметров — лимит по умолчанию, а не вся таблица", async () => {
      mockProfileRepo.findPage = sandbox.stub().resolves([[], 0]);

      const result = await service.getProfiles();

      expect(mockProfileRepo.findPage.firstCall.args[0]).to.deep.equal({
        offset: 0,
        limit: 20,
      });
      expect(result).to.deep.equal({
        items: [],
        total: 0,
        offset: 0,
        limit: 20,
      });
    });

    it("лимит больше максимума обрезается до 100", async () => {
      mockProfileRepo.findPage = sandbox.stub().resolves([[], 0]);

      await service.getProfiles(5, 1000);

      expect(mockProfileRepo.findPage.firstCall.args[0]).to.deep.equal({
        offset: 5,
        limit: 100,
      });
    });
  });

  describe("getProfileByAttr", () => {
    it("should return profile when found", async () => {
      mockProfileRepo.findOne.resolves(fakeProfile);

      const result = await service.getProfileByAttr({ userId: uuid() });

      expect(result).to.deep.equal(fakeProfile);
    });

    it("should throw NotFoundException when not found", async () => {
      mockProfileRepo.findOne.resolves(null);

      try {
        await service.getProfileByAttr({ userId: "nonexistent" });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal("PROFILE_NOT_FOUND");
        expect(err.status).to.equal(404);
      }
    });
  });

  describe("getProfileByUserId", () => {
    it("should return profile when found", async () => {
      mockProfileRepo.findByUserId.resolves(fakeProfile);

      const result = await service.getProfileByUserId(uuid());

      expect(result).to.deep.equal(fakeProfile);
      expect(mockProfileRepo.findByUserId.calledWith(uuid())).to.be.true;
    });

    it("should throw NotFoundException when not found", async () => {
      mockProfileRepo.findByUserId.resolves(null);

      try {
        await service.getProfileByUserId("nonexistent");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal("PROFILE_NOT_FOUND");
        expect(err.status).to.equal(404);
      }
    });
  });

  describe("updateProfile", () => {
    it("should update and return profile", async () => {
      const updatedProfile = { ...fakeProfile, firstName: "Updated" };

      mockProfileRepo.findByUserId.resolves(updatedProfile);

      const result = await service.updateProfile(uuid(), {
        firstName: "Updated",
      } as any);

      expect(result.firstName).to.equal("Updated");
      expect(mockProfileRepo.update.calledOnce).to.be.true;
      expect(mockProfileRepo.findByUserId.calledWith(uuid())).to.be.true;
    });

    it("should throw NotFoundException when profile not found after update", async () => {
      mockProfileRepo.findByUserId.resolves(null);

      try {
        await service.updateProfile("nonexistent", {
          firstName: "Updated",
        } as any);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal("PROFILE_NOT_FOUND");
        expect(err.status).to.equal(404);
      }
    });
  });

  describe("deleteProfile", () => {
    it("should clear personal fields and keep the record", async () => {
      mockProfileRepo.update.resolves({ affected: 1 });
      mockProfileRepo.findByUserId.resolves({
        ...fakeProfile,
        firstName: null,
        lastName: null,
      });

      const result = await service.deleteProfile(uuid());

      expect(result).to.be.undefined;
      expect(mockProfileRepo.delete.called).to.be.false;
      expect(mockProfileRepo.update.calledOnce).to.be.true;

      const [where, patch] = mockProfileRepo.update.firstCall.args;

      expect(where).to.deep.equal({ userId: uuid() });
      expect(patch).to.deep.equal({
        firstName: null,
        lastName: null,
        birthDate: null,
        gender: null,
      });
    });

    it("should throw NotFoundException when profile not found", async () => {
      mockProfileRepo.update.resolves({ affected: 0 });

      try {
        await service.deleteProfile("nonexistent");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).to.equal("PROFILE_NOT_FOUND");
      }
    });
  });

  describe("чужой профиль", () => {
    it("профиль суперпользователя меняет и очищает только суперпользователь — 403", async () => {
      access.isSuperUser.withArgs(fakeProfile.userId).resolves(true);

      for (const run of [
        () =>
          service.updateProfileOf(actor, fakeProfile.userId, {
            firstName: "X",
          }),
        () => service.clearProfileOf(actor, fakeProfile.userId),
      ]) {
        try {
          await run();
          expect.fail("should have thrown");
        } catch (err: any) {
          expect(err.code).to.equal("PROFILE_SUPERUSER_EDIT");
        }
      }
      expect(mockProfileRepo.update.called).to.be.false;
    });

    it("суперпользователь меняет профиль суперпользователя", async () => {
      access.isSuperUser.resolves(true);
      mockProfileRepo.findByUserId.resolves(fakeProfile);

      await service.updateProfileOf(
        { ...actor, roles: ["admin"], permissions: ["*"] },
        fakeProfile.userId,
        { firstName: "X" },
      );

      expect(mockProfileRepo.update.calledOnce).to.be.true;
    });

    it("обычный профиль меняется по праву", async () => {
      mockProfileRepo.findByUserId.resolves(fakeProfile);

      await service.updateProfileOf(actor, fakeProfile.userId, {
        firstName: "X",
      });

      expect(mockProfileRepo.update.calledOnce).to.be.true;
    });
  });
});
