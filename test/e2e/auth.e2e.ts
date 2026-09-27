import { expect } from "chai";

import {
  Actor,
  call,
  expectStatus,
  mail,
  signIn,
  signInAdmin,
  signUp,
  toActor,
  tokenFrom,
  uniqueEmail,
} from "./client";

describe("auth", () => {
  let alice: Actor;

  before(async () => {
    alice = await signUp("alice", { firstName: "Alice" });
  });

  describe("регистрация", () => {
    it("имя и фамилия из регистрации попадают в профиль", async () => {
      const res = expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-up", {
          email: uniqueEmail("named"),
          password: "named-Pass-2026",
          firstName: "Анна",
          lastName: "Иванова",
        }),
        201,
      );

      expect(res.data.profile).to.include({
        firstName: "Анна",
        lastName: "Иванова",
      });
    });

    it("по телефону в свободном формате, телефон хранится как +7", async () => {
      const res = expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-up", {
          phone: "8 (916) 555-10-01",
          password: "phone-Pass-2026",
        }),
        201,
      );

      expect(res.data.phone).to.equal("+79165551001");
    });

    it("тот же телефон в другом формате — 409", async () => {
      expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-up", {
          phone: "+7 916 555 10 01",
          password: "phone-Pass-2027",
        }),
        409,
      );
    });

    it("повтор email в другом регистре — 409", async () => {
      expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-up", {
          email: alice.email.toUpperCase(),
          password: "other-Pass-2026",
        }),
        409,
      );
    });

    it("слабый пароль — 400 VALIDATION_ERROR", async () => {
      expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-up", {
          email: uniqueEmail("weak"),
          password: "12345678",
        }),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("вход и токены", () => {
    it("неверный пароль и несуществующий логин отвечают одинаково", async () => {
      const wrong = await call(null, "POST", "/api/v1/auth/sign-in", {
        login: alice.email,
        password: "wrong-Pass-1",
      });
      const ghost = await call(null, "POST", "/api/v1/auth/sign-in", {
        login: uniqueEmail("ghost"),
        password: "wrong-Pass-1",
      });

      expectStatus(wrong, 401);
      expectStatus(ghost, 401);
      expect(wrong.data.code).to.equal(ghost.data.code);
    });

    it("refresh ротирует токен, повтор старого отзывает сессию", async () => {
      const user = await signIn(alice.email, alice.password);
      const rotated = expectStatus(
        await call(null, "POST", "/api/v1/auth/refresh", {
          refreshToken: user.refresh,
        }),
        200,
      );
      const next = rotated.data.tokens ?? rotated.data;

      expectStatus(
        await call(null, "POST", "/api/v1/auth/refresh", {
          refreshToken: user.refresh,
        }),
        401,
      );
      expectStatus(
        await call(null, "POST", "/api/v1/auth/refresh", {
          refreshToken: next.refreshToken,
        }),
        401,
      );
      // Access-токен отозванной сессии перестаёт работать сразу.
      expectStatus(await call(next.accessToken, "GET", "/api/v1/user/my"), 401);
    });

    it("refresh-токен не подходит как Bearer", async () => {
      expectStatus(await call(alice.refresh, "GET", "/api/v1/user/my"), 401);
    });

    it("sign-out завершает сессию, access сразу недействителен", async () => {
      const user = await signIn(alice.email, alice.password);

      expectStatus(await call(user, "POST", "/api/v1/auth/sign-out"), 204);
      expectStatus(await call(user, "GET", "/api/v1/user/my"), 401);
      expectStatus(
        await call(null, "POST", "/api/v1/auth/refresh", {
          refreshToken: user.refresh,
        }),
        401,
      );
    });

    it("sign-out-all завершает все сессии", async () => {
      const a = await signIn(alice.email, alice.password);
      const b = await signIn(alice.email, alice.password);

      expectStatus(await call(a, "POST", "/api/v1/auth/sign-out-all"), 204);
      expectStatus(await call(b, "GET", "/api/v1/user/my"), 401);
      alice = await signIn(alice.email, alice.password);
    });

    it("после 5 неудач аккаунт блокируется: 429 AUTH_ACCOUNT_LOCKED и Retry-After", async () => {
      const victim = await signUp("lock");

      for (let i = 0; i < 5; i += 1) {
        await call(null, "POST", "/api/v1/auth/sign-in", {
          login: victim.email,
          password: `wrong-Pass-${i}`,
        });
      }

      const locked = expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-in", {
          login: victim.email,
          password: victim.password,
        }),
        429,
        "AUTH_ACCOUNT_LOCKED",
      );

      expect(locked.headers.get("retry-after")).to.be.a("string");
    });
  });

  describe("2FA", () => {
    it("включение, вход через второй фактор, одноразовый токен, выключение", async () => {
      const user = await signUp("twofa");

      expectStatus(
        await call(user, "POST", "/api/v1/auth/enable-2fa", {
          currentPassword: "wrong-Pass-1",
          password: "second-Factor-1",
        }),
        403,
      );
      expectStatus(
        await call(user, "POST", "/api/v1/auth/enable-2fa", {
          currentPassword: user.password,
          password: "second-Factor-1",
          hint: "книга",
        }),
        200,
      );

      const first = expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-in", {
          login: user.email,
          password: user.password,
        }),
        200,
      );
      const twoFactorToken =
        first.data.twoFactorToken ?? first.data.tokens?.twoFactorToken;

      expect(twoFactorToken, "twoFactorToken").to.be.a("string");
      expect(first.data.tokens?.accessToken).to.equal(undefined);
      expectStatus(await call(twoFactorToken, "GET", "/api/v1/user/my"), 401);
      expectStatus(
        await call(null, "POST", "/api/v1/auth/verify-2fa", {
          twoFactorToken,
          password: "wrong-Factor-1",
        }),
        [400, 401],
      );

      const verified = expectStatus(
        await call(null, "POST", "/api/v1/auth/verify-2fa", {
          twoFactorToken,
          password: "second-Factor-1",
        }),
        200,
      );
      const session = toActor(verified, user);

      expectStatus(
        await call(null, "POST", "/api/v1/auth/verify-2fa", {
          twoFactorToken,
          password: "second-Factor-1",
        }),
        [400, 401],
      );
      expectStatus(
        await call(session, "POST", "/api/v1/auth/disable-2fa", {
          currentPassword: user.password,
          password: "second-Factor-1",
        }),
        200,
      );
    });
  });

  describe("сброс пароля", () => {
    it("ссылка из письма меняет пароль один раз и завершает старые сессии", async () => {
      const user = await signUp("reset");
      const r1 = expectStatus(
        await call(null, "POST", "/api/v1/auth/request-reset-password", {
          login: user.email,
        }),
        200,
      );
      const ghostEmail = uniqueEmail("ghost");
      const r2 = expectStatus(
        await call(null, "POST", "/api/v1/auth/request-reset-password", {
          login: ghostEmail,
        }),
        200,
      );

      expect(r1.data).to.deep.equal(r2.data);

      const token = tokenFrom(await mail.last(user.email));

      expect(await mail.none(ghostEmail, 500)).to.equal(true);
      expectStatus(
        await call(null, "POST", "/api/v1/auth/reset-password", {
          token,
          password: "reset-New-Pass-1",
        }),
        200,
      );
      expectStatus(
        await call(null, "POST", "/api/v1/auth/reset-password", {
          token,
          password: "reset-Other-Pass-1",
        }),
        [400, 401],
      );
      expectStatus(
        await call(null, "POST", "/api/v1/auth/refresh", {
          refreshToken: user.refresh,
        }),
        401,
      );
      await signIn(user.email, "reset-New-Pass-1");
    });
  });

  describe("админ из конфига", () => {
    it("входит и видит всех пользователей", async () => {
      const admin = await signInAdmin();

      expectStatus(await call(admin, "GET", "/api/v1/user/all?limit=5"), 200);
    });
  });
});
