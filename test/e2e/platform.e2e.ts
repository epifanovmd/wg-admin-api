import { expect } from "chai";
import { generateKeyPairSync, sign } from "crypto";

import {
  Actor,
  call,
  eventually,
  expectStatus,
  items,
  signInAdmin,
  signUp,
  uniqueEmail,
} from "./client";

describe("платформа", () => {
  let admin: Actor;
  let alice: Actor;
  let bob: Actor;

  before(async () => {
    admin = await signInAdmin();
    alice = await signUp("p-alice", { firstName: "Alice" });
    bob = await signUp("p-bob", { firstName: "Bob" });
  });

  describe("API-ключи и задачи", () => {
    it("API-ключ: выдаётся один раз, чужой scope — 403, отзыв — 401", async () => {
      expectStatus(
        await call(alice, "POST", "/api/v1/api-keys", {
          name: "x",
          scopes: ["wg-agent:*"],
        }),
        403,
      );

      const created = expectStatus(
        await call(admin, "POST", "/api/v1/api-keys", {
          name: "stray-agent",
          scopes: ["wg-agent:00000000-0000-4000-8000-000000000000"],
        }),
        201,
      );
      const key = created.data.key;

      expect(key).to.match(/^[\w-]{8}\.[\w-]+$/);

      const list = expectStatus(
        await call(admin, "GET", "/api/v1/api-keys"),
        200,
      );

      expect(JSON.stringify(list.data)).to.not.include(key.split(".")[1]);

      // Ключ агента без существующей ноды — отказ протокола агента.
      expectStatus(
        await call(key, "GET", "/api/v1/wg-agent/state?waitMs=0", undefined, {
          scheme: "ApiKey",
        }),
        403,
        "WG_NODE_AGENT_SCOPE_INVALID",
      );
      expectStatus(
        await call(
          admin,
          "POST",
          `/api/v1/api-keys/${created.data.apiKey.id}/revoke`,
        ),
        204,
      );
      expectStatus(
        await call(key, "GET", "/api/v1/wg-agent/state?waitMs=0", undefined, {
          scheme: "ApiKey",
        }),
        401,
      );
    });

    it("видимая задача: владелец видит и отменяет, чужой — нет", async () => {
      const node = expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", { name: "jobs-node" }),
        201,
      ).data.node;
      const job = expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${node.id}/provision`, {
          host: "127.0.0.1",
          port: 2298,
          password: "e2e",
        }),
        202,
      ).data;

      expectStatus(await call(admin, "GET", `/api/v1/jobs/${job.jobId}`), 200);

      const list = expectStatus(
        await call(admin, "GET", "/api/v1/jobs?limit=5"),
        200,
      );

      expect(items(list.data).map((run: any) => run.id)).to.include(job.jobId);
      expectStatus(
        await call(bob, "GET", `/api/v1/jobs/${job.jobId}`),
        [403, 404],
      );
      // Задача могла уже упасть (хост недоступен) — тогда отменять нечего.
      expectStatus(
        await call(admin, "POST", `/api/v1/jobs/${job.jobId}/cancel`),
        [204, 409],
      );
      await eventually(
        async () => {
          const res = await call(admin, "GET", `/api/v1/jobs/${job.jobId}`);

          return ["failed", "cancelled"].includes(res.data?.status);
        },
        { what: "задача завершена" },
      );
    });
  });

  describe("биометрия", () => {
    it("биометрия: вход по подписи, nonce одноразовый", async () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const spki = publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64");
      const signNonce = (nonce: string) =>
        sign("sha256", Buffer.from(nonce), privateKey).toString("base64");

      expectStatus(
        await call(bob, "POST", "/api/v1/biometric/register", {
          deviceId: "iphone-15",
          deviceName: "iPhone Bob",
          publicKey: spki,
        }),
        200,
      );
      expectStatus(
        await call(bob, "POST", "/api/v1/biometric/register", {
          deviceId: "",
          deviceName: "x".repeat(200),
          publicKey: "",
        }),
        400,
      );
      expectStatus(await call(bob, "GET", "/api/v1/biometric/devices"), 200);

      const nonce = (
        await call(null, "POST", "/api/v1/biometric/generate-nonce", {
          userId: bob.id,
          deviceId: "iphone-15",
        })
      ).data.nonce;

      expectStatus(
        await call(null, "POST", "/api/v1/biometric/verify-signature", {
          userId: bob.id,
          deviceId: "iphone-15",
          nonce,
          signature: "AAAA",
        }),
        401,
      );

      const fresh = (
        await call(null, "POST", "/api/v1/biometric/generate-nonce", {
          userId: bob.id,
          deviceId: "iphone-15",
        })
      ).data.nonce;
      const login = expectStatus(
        await call(null, "POST", "/api/v1/biometric/verify-signature", {
          userId: bob.id,
          deviceId: "iphone-15",
          nonce: fresh,
          signature: signNonce(fresh),
        }),
        200,
      );

      expect((login.data.tokens ?? login.data).accessToken).to.be.a("string");
      expectStatus(
        await call(null, "POST", "/api/v1/biometric/verify-signature", {
          userId: bob.id,
          deviceId: "iphone-15",
          nonce: fresh,
          signature: signNonce(fresh),
        }),
        401,
      );
      expectStatus(
        await call(bob, "DELETE", "/api/v1/biometric/iphone-15"),
        204,
      );
    });
  });

  describe("passkeys", () => {
    it("passkeys: опции, поддельные ответы отклоняются, аккаунт не раскрывается", async () => {
      expectStatus(
        await call(
          alice,
          "POST",
          "/api/v1/passkeys/generate-registration-options",
        ),
        200,
      );
      expectStatus(
        await call(alice, "POST", "/api/v1/passkeys/verify-registration", {
          data: {
            id: "x",
            rawId: "x",
            type: "public-key",
            response: { clientDataJSON: "e30", attestationObject: "AA" },
            clientExtensionResults: {},
          },
        }),
        400,
      );
      expectStatus(await call(alice, "GET", "/api/v1/passkeys"), 200);

      const known = expectStatus(
        await call(
          null,
          "POST",
          "/api/v1/passkeys/generate-authentication-options",
          {
            login: alice.email,
          },
        ),
        200,
      );
      const unknown = expectStatus(
        await call(
          null,
          "POST",
          "/api/v1/passkeys/generate-authentication-options",
          {
            login: uniqueEmail("ghost"),
          },
        ),
        200,
      );

      expect(known.data.allowCredentials).to.have.length(1);
      expect(unknown.data.allowCredentials).to.have.length(1);
      expectStatus(
        await call(null, "POST", "/api/v1/passkeys/verify-authentication", {
          data: {
            id: "x",
            rawId: "x",
            type: "public-key",
            response: {
              clientDataJSON: "e30",
              authenticatorData: "AA",
              signature: "AA",
            },
            clientExtensionResults: {},
          },
        }),
        401,
      );
      expectStatus(
        await call(
          alice,
          "DELETE",
          "/api/v1/passkeys/00000000-0000-4000-8000-000000000000",
        ),
        404,
      );
    });
  });

  describe("версия бэкенда", () => {
    it("любому вошедшему — версия, коммит, время сборки и запуска, версия агента; без входа — 401", async () => {
      expectStatus(await call(null, "GET", "/api/v1/app/version"), 401);

      const { data } = expectStatus(
        await call(alice, "GET", "/api/v1/app/version"),
        200,
      );

      expect(data.version).to.be.a("string").with.length.greaterThan(0);
      expect(data).to.have.property("commit");
      expect(data).to.have.property("builtAt");
      expect(data).to.have.property("agentVersion");
      expect(new Date(data.startedAt).getTime()).to.be.at.most(Date.now());
    });
  });
});
