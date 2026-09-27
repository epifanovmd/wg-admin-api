import { expect } from "chai";
import Redis from "ioredis";
import sinon from "sinon";

import { LiveStore } from "./live-store";

/** Экземпляр без Redis (память процесса) или с подставленным клиентом. */
const createStore = (redis?: unknown): LiveStore => {
  const store = new LiveStore("test:");

  (store as unknown as { _redis: unknown })._redis = redis;

  return store;
};

describe("LiveStore", () => {
  afterEach(() => sinon.restore());

  describe("без Redis — память процесса", () => {
    it("JSON с TTL: живёт до истечения, затем пропадает", async () => {
      const clock = sinon.useFakeTimers({ now: 1_000_000 });
      const store = createStore();

      await store.setJson("a", { n: 1 }, 10);
      expect(await store.getJson("a")).to.deep.equal({ n: 1 });

      clock.tick(11_000);
      expect(await store.getJson("a")).to.equal(null);
    });

    it("setIfAbsent не перезаписывает; incrBy копит и округляет", async () => {
      const store = createStore();

      expect(await store.setIfAbsent("base", 5, 60)).to.equal(5);
      expect(await store.setIfAbsent("base", 9, 60)).to.equal(5);
      expect(await store.incrBy("sum", 2.4, 60)).to.equal(2);
      expect(await store.incrBy("sum", 3, 60)).to.equal(5);

      await store.delete("sum");
      expect(await store.getJson("sum")).to.equal(null);
    });
  });

  describe("с Redis", () => {
    it("ключи — с префиксом модуля, TTL и NX передаются", async () => {
      const redis = {
        get: sinon.stub().resolves("7"),
        set: sinon.stub().resolves("OK"),
        del: sinon.stub().resolves(1),
        incrby: sinon.stub().resolves(12),
        expire: sinon.stub().resolves(1),
      };
      const store = createStore(redis);

      await store.setJson("a", { n: 1 }, 30);
      expect(redis.set.firstCall.args).to.deep.equal([
        "test:a",
        '{"n":1}',
        "EX",
        30,
      ]);

      expect(await store.setIfAbsent("b", 3, 60)).to.equal(7);
      expect(redis.set.secondCall.args).to.deep.equal([
        "test:b",
        "3",
        "EX",
        60,
        "NX",
      ]);

      expect(await store.incrBy("c", 5, 90)).to.equal(12);
      expect(redis.expire.firstCall.args).to.deep.equal(["test:c", 90]);

      await store.delete("a");
      expect(redis.del.firstCall.args).to.deep.equal(["test:a"]);
    });
  });

  /** Пакетные операции: одинаковое поведение в памяти процесса и в Redis. */
  const batchContract = (make: () => LiveStore) => {
    it("getJsonMany/setJsonMany: порядок ключей, отсутствующие — null", async () => {
      const store = make();

      await store.setJsonMany(
        [
          ["m:a", { n: 1 }],
          ["m:b", { n: 2 }],
        ],
        60,
      );

      expect(await store.getJsonMany(["m:b", "m:none", "m:a"])).to.deep.equal([
        { n: 2 },
        null,
        { n: 1 },
      ]);
      expect(await store.getJsonMany([])).to.deep.equal([]);
    });

    it("setIfAbsentMany не перезаписывает, incrByMany копит", async () => {
      const store = make();

      expect(
        await store.setIfAbsentMany(
          [
            ["c:x", 5],
            ["c:y", 7],
          ],
          60,
        ),
      ).to.deep.equal([5, 7]);
      expect(
        await store.setIfAbsentMany(
          [
            ["c:x", 50],
            ["c:z", 1],
          ],
          60,
        ),
      ).to.deep.equal([5, 1]);
      expect(
        await store.incrByMany(
          [
            ["c:x", 2],
            ["c:y", 0.4],
          ],
          60,
        ),
      ).to.deep.equal([7, 7]);
    });

    it("pushCapped хранит последние max значений, listRecent — от старых к новым", async () => {
      const store = make();

      for (let n = 1; n <= 5; n += 1) {
        await store.pushCapped([["w:a", { n }]], 3, 60);
      }

      expect(await store.listRecent("w:a")).to.deep.equal([
        { n: 3 },
        { n: 4 },
        { n: 5 },
      ]);
      expect(await store.listRecent("w:none")).to.deep.equal([]);
    });
  };

  describe("пакетные операции — память процесса", () => {
    batchContract(() => createStore());
  });

  // Настоящий Redis: `TEST_REDIS_URL=redis://…/15` (база очищается).
  const REDIS_URL = process.env.TEST_REDIS_URL;

  describe("пакетные операции — Redis (TEST_REDIS_URL)", () => {
    let redis: Redis | undefined;

    before(async function () {
      if (!REDIS_URL) return this.skip();
      redis = new Redis(REDIS_URL);
      await redis.flushdb();
    });

    after(async () => {
      await redis?.flushdb();
      await redis?.quit();
    });

    batchContract(() => createStore(redis));
  });
});
