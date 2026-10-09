import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { hashToken, HttpException } from "../../core";
import {
  createMockEventBus,
  createMockRepository,
  uuid,
} from "../../test/helpers";
import { ApiKeyError } from "./api-key.errors";
import { ApiKeyService, parseApiKey } from "./api-key.service";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "./events";

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail("должно было упасть");
  } catch (err) {
    expect(err).to.be.instanceOf(HttpException);
    expect((err as HttpException).code).to.equal(code);
  }
};

describe("ApiKeyService", () => {
  let repo: ReturnType<typeof createMockRepository> & {
    findById: sinon.SinonStub;
    findByPrefix: sinon.SinonStub;
    findPage: sinon.SinonStub;
    touch: sinon.SinonStub;
  };
  let service: ApiKeyService;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    eventBus = createMockEventBus();
    repo = Object.assign(createMockRepository(), {
      findById: sinon.stub().resolves(null),
      findByPrefix: sinon.stub().resolves(null),
      findPage: sinon.stub().resolves([[], 0]),
      touch: sinon.stub().resolves(),
    });
    repo.createAndSave.callsFake(async (data: any) => ({
      id: "k1",
      createdAt: new Date(),
      ...data,
    }));
    service = new ApiKeyService(repo as any, eventBus as any);
  });

  const stored = (key: string, overrides: Record<string, unknown> = {}) => {
    const { prefix, secret } = parseApiKey(key)!;

    return {
      id: "k1",
      prefix,
      hash: hashToken(secret),
      scopes: ["integration:*"],
      ownerId: uuid(),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      ...overrides,
    };
  };

  it("create: ключ <prefix 8>.<secret>, в БД только хеш секрета", async () => {
    const { key, apiKey } = await service.create(uuid(), {
      name: "integration",
      scopes: ["integration:sync", "integration:sync"],
    });

    expect(key).to.match(/^[\w-]{8}\.[\w-]{43}$/);

    const saved = repo.createAndSave.firstCall.args[0];

    expect(saved.prefix).to.equal(key.slice(0, 8));
    expect(saved.hash).to.equal(hashToken(key.slice(9)));
    expect(saved.hash).to.not.contain(key.slice(9));
    expect(saved.scopes).to.deep.equal(["integration:sync"]);
    expect(apiKey).to.not.have.property("hash");
  });

  it("create: коллизия префикса — новая попытка", async () => {
    const { QueryFailedError } = await import("typeorm");
    const unique = new QueryFailedError("insert", [], {
      code: "23505",
    } as any);

    repo.createAndSave.onFirstCall().rejects(unique);

    await service.create(uuid(), { name: "w", scopes: ["integration:*"] });
    expect(repo.createAndSave.callCount).to.equal(2);
  });

  it("verify: верный ключ", async () => {
    const { key } = await service.create(uuid(), {
      name: "w",
      scopes: ["integration:*"],
    });

    repo.findByPrefix.resolves(stored(key));

    const apiKey = await service.verify(key);

    expect(apiKey.id).to.equal("k1");
    expect(repo.findByPrefix.calledWith(key.slice(0, 8))).to.be.true;
  });

  it("verify: неверный секрет, отозванный, просроченный, чужой формат — 401", async () => {
    const { key } = await service.create(uuid(), {
      name: "w",
      scopes: ["integration:*"],
    });

    repo.findByPrefix.resolves(stored(key, { hash: hashToken("other") }));
    await expectCode(service.verify(key), ApiKeyError.codes.INVALID);

    repo.findByPrefix.resolves(stored(key, { revokedAt: new Date() }));
    await expectCode(service.verify(key), ApiKeyError.codes.INVALID);

    repo.findByPrefix.resolves(
      stored(key, { expiresAt: new Date(Date.now() - 1000) }),
    );
    await expectCode(service.verify(key), ApiKeyError.codes.INVALID);

    await expectCode(service.verify("garbage"), ApiKeyError.codes.INVALID);
    await expectCode(
      service.verify(`${"a".repeat(8)}.${"b".repeat(200)}`),
      ApiKeyError.codes.INVALID,
    );
  });

  it("verify: lastUsedAt — не чаще раза в минуту", async () => {
    const { key } = await service.create(uuid(), {
      name: "w",
      scopes: ["integration:*"],
    });

    repo.findByPrefix.resolves(stored(key, { lastUsedAt: new Date() }));
    await service.verify(key);
    expect(repo.touch.called).to.be.false;

    repo.findByPrefix.resolves(
      stored(key, { lastUsedAt: new Date(Date.now() - 120_000) }),
    );
    await service.verify(key);
    expect(repo.touch.calledOnce).to.be.true;
  });

  it("create и revoke публикуют события для журнала аудита", async () => {
    await service.create("owner-1", { name: "w", scopes: ["integration:*"] });
    repo.findById.resolves({ id: "k1", name: "w", revokedAt: null });
    await service.revoke("k1", "admin-1");

    const events = eventBus.emit.getCalls().map(c => c.args[0]);

    expect(events[0]).to.be.instanceOf(ApiKeyCreatedEvent);
    expect(events[0]).to.include({ apiKeyId: "k1", ownerId: "owner-1" });
    expect(events[1]).to.be.instanceOf(ApiKeyRevokedEvent);
    expect(events[1]).to.include({ apiKeyId: "k1", revokedBy: "admin-1" });
  });

  it("revoke: отзывает, повторно — без изменений, неизвестный — 404", async () => {
    repo.findById.resolves({ id: "k1", revokedAt: null });
    await service.revoke("k1");
    expect(repo.update.firstCall.args[1].revokedAt).to.be.instanceOf(Date);

    repo.findById.resolves({ id: "k1", revokedAt: new Date() });
    await service.revoke("k1");
    expect(repo.update.calledOnce).to.be.true;

    repo.findById.resolves(null);
    await expectCode(service.revoke("k1"), ApiKeyError.codes.NOT_FOUND);
  });

  it("list: страница без секретов", async () => {
    repo.findPage.resolves([
      [{ id: "k1", name: "w", prefix: "abcdefgh", hash: "h", scopes: [] }],
      1,
    ]);

    const page = await service.list(0, 10);

    expect(page.total).to.equal(1);
    expect(page.limit).to.equal(10);
    expect(page.items[0]).to.not.have.property("hash");
  });
});
