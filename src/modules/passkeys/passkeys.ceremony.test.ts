import "reflect-metadata";

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { expect } from "chai";
import { createHash, generateKeyPairSync, randomBytes, sign } from "crypto";
import sinon from "sinon";

import { config } from "../../config";
import { createMockEventBus, uuid } from "../../test/helpers";
import { Passkey } from "./passkey.entity";
import type { PasskeyChallenge } from "./passkey-challenge.entity";
import { PasskeysService } from "./passkeys.service";

/**
 * Церемонии WebAuthn целиком — с настоящей проверкой подписи библиотекой:
 * аутентификатор (P-256, attestation `none`) собирается здесь же, хранилища
 * challenge и ключей — в памяти.
 */
const { webAuthn } = config.auth;
const rpID = webAuthn.rpHost;
const origin = `${webAuthn.rpSchema}://${rpID}${webAuthn.rpPort ? `:${webAuthn.rpPort}` : ""}`;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();
const u16 = (value: number) => {
  const buf = Buffer.alloc(2);

  buf.writeUInt16BE(value);

  return buf;
};
const u32 = (value: number) => {
  const buf = Buffer.alloc(4);

  buf.writeUInt32BE(value);

  return buf;
};
const text = (value: string) => Buffer.from(value, "utf8");

/** Аутентификатор платформы: счётчик подписей всегда 0 (как у passkey Apple/Google). */
const makeAuthenticator = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  // COSE_Key EC2: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  const credentialId = randomBytes(16);
  const id = credentialId.toString("base64url");
  const rpIdHash = sha256(text(rpID));
  const clientData = (type: string, challenge: string) =>
    text(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id,
    register(challenge: string): RegistrationResponseJSON {
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]), // UP | UV | AT
        u32(0),
        Buffer.alloc(16),
        u16(credentialId.length),
        credentialId,
        cose,
      ]);
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3, 0x63]),
        text("fmt"),
        Buffer.from([0x64]),
        text("none"),
        Buffer.from([0x67]),
        text("attStmt"),
        Buffer.from([0xa0, 0x68]),
        text("authData"),
        Buffer.from([0x59]),
        u16(authData.length),
        authData,
      ]);

      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData("webauthn.create", challenge).toString(
            "base64url",
          ),
          attestationObject: attestationObject.toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    login(challenge: string, tamper = false): AuthenticationResponseJSON {
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), u32(0)]);
      const data = clientData("webauthn.get", challenge);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, sha256(data)]),
        privateKey,
      );

      if (tamper) {
        signature[signature.length - 1] =
          (signature[signature.length - 1] + 1) % 256;
      }

      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: data.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
};

/** Хранилища в памяти с семантикой БД: уникальный id ключа, атомарное удаление. */
const makeStores = () => {
  let challenges: PasskeyChallenge[] = [];
  const passkeys = new Map<string, Passkey>();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const insertPasskey = async (passkey: Passkey) => {
    await tick();
    if (passkeys.has(passkey.id)) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    passkeys.set(passkey.id, { ...passkey, createdAt: new Date() });

    return passkey;
  };
  const deleteChallenges = async (where: Partial<PasskeyChallenge>) => {
    await tick();
    const before = challenges.length;

    challenges = challenges.filter(
      row =>
        !Object.entries(where).every(
          ([key, value]) => row[key as keyof PasskeyChallenge] === value,
        ),
    );

    return { affected: before - challenges.length };
  };

  const challengeRepo = {
    createChallenge: async (userId: string, challenge: string) => {
      await tick();
      const row = {
        id: uuid(),
        userId,
        challenge,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      };

      challenges.push(row);

      return row;
    },
    consumeChallenge: async (userId: string, challenge: string) => {
      const { affected } = await deleteChallenges({ userId, challenge });

      return affected > 0;
    },
    deleteByUserId: (userId: string) => deleteChallenges({ userId }),
    deleteExpired: async () => 0,
  };
  const passkeysRepo = {
    findById: async (id: string) => {
      await tick();

      return passkeys.get(id) ?? null;
    },
    findByUserId: async (userId: string) => {
      await tick();

      return [...passkeys.values()].filter(p => p.userId === userId);
    },
    createAndSave: (passkey: Passkey) => insertPasskey(passkey),
    update: async (id: string, patch: Partial<Passkey>) => {
      await tick();
      const current = passkeys.get(id);

      if (current) passkeys.set(id, { ...current, ...patch });

      return { affected: current ? 1 : 0 };
    },
  };

  return {
    challengeRepo,
    passkeysRepo,
    passkeys,
    challenges: () => challenges,
  };
};

describe("PasskeysService: церемонии WebAuthn", () => {
  const userId = uuid();
  const login = "owner@example.com";
  let stores: ReturnType<typeof makeStores>;
  let completeLogin: sinon.SinonStub;
  let service: PasskeysService;

  const registered = async () => {
    const authenticator = makeAuthenticator();
    const options = await service.generateRegistrationOptions(userId);

    await service.verifyRegistration(
      userId,
      authenticator.register(options.challenge),
    );

    return authenticator;
  };

  beforeEach(() => {
    stores = makeStores();
    completeLogin = sinon
      .stub()
      .resolves({ tokens: { accessToken: "at", refreshToken: "rt" } });

    const user = { id: userId, email: login, phone: null };

    service = new PasskeysService(
      {
        getUser: sinon.stub().resolves(user),
        getUserByAttr: sinon.stub().resolves(user),
      } as any,
      stores.passkeysRepo as any,
      stores.challengeRepo as any,
      { completeLogin } as any,
      createMockEventBus() as any,
    );
  });

  it("регистрация и вход проходят с настоящей подписью", async () => {
    const authenticator = await registered();
    const options = await service.generateAuthenticationOptions(login);
    const result = await service.verifyAuthentication(
      authenticator.login(options.challenge),
    );

    expect(result.verified).to.equal(true);
    expect(stores.passkeys.get(authenticator.id)?.lastUsed).to.be.instanceOf(
      Date,
    );
  });

  it("вход: тот же ответ аутентификатора дважды параллельно — одна сессия", async () => {
    // Challenge удалялся после проверки подписи: оба запроса находили его и
    // открывали по сессии. Счётчик не спасает — у passkey платформ он 0.
    const authenticator = await registered();
    const options = await service.generateAuthenticationOptions(login);
    const response = authenticator.login(options.challenge);

    const results = await Promise.allSettled([
      service.verifyAuthentication(response),
      service.verifyAuthentication(response),
    ]);

    expect(results.filter(r => r.status === "fulfilled")).to.have.length(1);
    expect(results.find(r => r.status === "rejected")?.reason).to.include({
      status: 401,
      code: "PASSKEY_AUTH_FAILED",
    });
    expect(completeLogin.calledOnce).to.equal(true);
  });

  it("вход: чужой запрос параметров входа не ломает подписанный challenge", async () => {
    // Параметры входа выдаются без авторизации по логину: проверялся
    // «последний» challenge пользователя — любой мог сорвать его вход.
    const authenticator = await registered();
    const options = await service.generateAuthenticationOptions(login);

    await service.generateAuthenticationOptions(login);

    const result = await service.verifyAuthentication(
      authenticator.login(options.challenge),
    );

    expect(result.verified).to.equal(true);
  });

  it("вход: challenge одноразовый — неудачная попытка его гасит", async () => {
    const authenticator = await registered();
    const options = await service.generateAuthenticationOptions(login);

    for (const tamper of [true, false]) {
      try {
        await service.verifyAuthentication(
          authenticator.login(options.challenge, tamper),
        );
        expect.fail("вход не должен пройти");
      } catch (err) {
        expect(err).to.include({ status: 401, code: "PASSKEY_AUTH_FAILED" });
      }
    }
    expect(completeLogin.called).to.equal(false);
  });

  it("регистрация: повтор того же ответа параллельно — один ключ, повтор — 4xx, не 500", async () => {
    const authenticator = makeAuthenticator();
    const options = await service.generateRegistrationOptions(userId);
    const response = authenticator.register(options.challenge);

    const results = await Promise.allSettled([
      service.verifyRegistration(userId, response),
      service.verifyRegistration(userId, response),
    ]);

    expect(results.filter(r => r.status === "fulfilled")).to.have.length(1);

    const { reason } = results.find(r => r.status === "rejected") as {
      reason: { status: number };
    };

    expect(reason.status).to.be.within(400, 499);
    expect(stores.passkeys.size).to.equal(1);
  });

  it("регистрация не гасит challenge входа, начатого на другом устройстве", async () => {
    const phone = await registered();
    const loginOptions = await service.generateAuthenticationOptions(login);

    await registered();

    const result = await service.verifyAuthentication(
      phone.login(loginOptions.challenge),
    );

    expect(result.verified).to.equal(true);
  });
});
