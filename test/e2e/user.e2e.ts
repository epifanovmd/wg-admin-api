import { expect } from "chai";

import {
  Actor,
  call,
  codeFrom,
  eventually,
  expectStatus,
  items,
  mail,
  signIn,
  signInAdmin,
  signUp,
  uniqueEmail,
} from "./client";

describe("user и profile", () => {
  let alice: Actor;
  let bob: Actor;
  let admin: Actor;

  before(async () => {
    alice = await signUp("u-alice", { firstName: "Alice" });
    bob = await signUp("u-bob", { firstName: "Bob" });
    admin = await signInAdmin();
  });

  describe("профиль пользователя", () => {
    it("username: установка и занятость", async () => {
      const name = `alice_${Date.now().toString(36)}`;

      expectStatus(
        await call(alice, "PATCH", "/api/v1/user/my/username", {
          username: name,
        }),
        200,
      );
      expectStatus(
        await call(bob, "PATCH", "/api/v1/user/my/username", {
          username: name,
        }),
        409,
      );
    });

    it("телефон нормализуется, чужой — 409", async () => {
      const phone = `+7916${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
      const me = expectStatus(
        await call(alice, "PATCH", "/api/v1/user/my/update", {
          phone: `8${phone.slice(2)}`,
        }),
        200,
      );

      expect(me.data.phone).to.equal(phone);
      expectStatus(
        await call(bob, "PATCH", "/api/v1/user/my/update", { phone }),
        409,
      );
    });

    it("профиль: обновление, валидация дат и длины", async () => {
      expectStatus(await call(alice, "GET", "/api/v1/profile/my"), 200);
      expectStatus(
        await call(alice, "PATCH", "/api/v1/profile/my/update", {
          firstName: "Alisa",
          birthDate: "1995-04-01",
          gender: "female",
          locale: "en",
        }),
        200,
      );
      expectStatus(
        await call(alice, "PATCH", "/api/v1/profile/my/update", {
          birthDate: "2999-01-01",
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectStatus(
        await call(alice, "PATCH", "/api/v1/profile/my/update", {
          firstName: "x".repeat(41),
        }),
        400,
      );
      expectStatus(await call(bob, "GET", `/api/v1/profile/${alice.id}`), 200);
    });

    it("очистка профиля оставляет запись", async () => {
      const user = await signUp("u-clear", { firstName: "Clear" });

      expectStatus(
        await call(user, "DELETE", "/api/v1/profile/my/delete"),
        204,
      );

      const profile = expectStatus(
        await call(user, "GET", "/api/v1/profile/my"),
        200,
      );

      expect(profile.data.firstName ?? null).to.equal(null);
    });
  });

  describe("email", () => {
    it("подтверждение адреса кодом из письма, повтор раньше минуты — 429", async () => {
      const user = await signUp("u-verify");

      expectStatus(
        await call(user, "POST", "/api/v1/user/verify-email/request"),
        204,
      );
      expectStatus(
        await call(user, "POST", "/api/v1/user/verify-email/request"),
        429,
      );

      const code = codeFrom(await mail.last(user.email));

      expectStatus(
        await call(user, "POST", "/api/v1/user/verify-email", {
          code: code === "000000" ? "111111" : "000000",
        }),
        [400, 403],
      );
      expectStatus(
        await call(user, "POST", "/api/v1/user/verify-email", { code }),
        204,
      );

      const me = await call(user, "GET", "/api/v1/user/my");

      expect(me.data.emailVerified).to.equal(true);
    });

    it("смена email: код на новый адрес, уведомление на старый, адрес меняется после подтверждения", async () => {
      const user = await signUp("u-change");
      const newEmail = uniqueEmail("u-changed");

      expectStatus(
        await call(user, "PATCH", "/api/v1/user/my/update", {
          email: newEmail,
        }),
        200,
      );

      const before = await call(user, "GET", "/api/v1/user/my");

      expect(before.data.email).to.equal(user.email);
      await mail.last(user.email);

      const code = codeFrom(await mail.last(newEmail));

      expectStatus(
        await call(user, "POST", "/api/v1/user/my/email/confirm", {
          code: code === "000000" ? "111111" : "000000",
        }),
        [400, 403],
      );
      expectStatus(
        await call(user, "POST", "/api/v1/user/my/email/confirm", { code }),
        200,
      );

      const after = await call(user, "GET", "/api/v1/user/my");

      expect(after.data.email).to.equal(newEmail);
      expect(after.data.emailVerified).to.equal(true);
      await signIn(newEmail, user.password);
    });

    it("смена на занятый адрес — 409", async () => {
      expectStatus(
        await call(bob, "PATCH", "/api/v1/user/my/update", {
          email: alice.email,
        }),
        409,
      );
    });
  });

  describe("пароль и удаление", () => {
    it("смена пароля: текущий обязателен, другие сессии завершаются", async () => {
      const user = await signUp("u-pass");
      const other = await signIn(user.email, user.password);

      expectStatus(
        await call(user, "POST", "/api/v1/user/changePassword", {
          currentPassword: "wrong-Pass-1",
          newPassword: "u-New-Pass-2026",
        }),
        [400, 403],
      );
      expectStatus(
        await call(user, "POST", "/api/v1/user/changePassword", {
          currentPassword: user.password,
          newPassword: "u-New-Pass-2026",
        }),
        204,
      );
      expectStatus(await call(other, "GET", "/api/v1/user/my"), 401);
      expectStatus(await call(user, "GET", "/api/v1/user/my"), 200);
    });

    it("удаление аккаунта требует пароль, после — вход невозможен", async () => {
      const user = await signUp("u-delete");

      expectStatus(
        await call(user, "POST", "/api/v1/user/my/delete", {
          password: "wrong-Pass-1",
        }),
        403,
      );
      expectStatus(
        await call(user, "POST", "/api/v1/user/my/delete", {
          password: user.password,
        }),
        204,
      );
      expectStatus(
        await call(null, "POST", "/api/v1/auth/sign-in", {
          login: user.email,
          password: user.password,
        }),
        401,
      );
      expectStatus(await call(user, "GET", "/api/v1/user/my"), 401);
    });
  });

  describe("администрирование", () => {
    it("обычный пользователь не видит чужие данные и не повышает себя", async () => {
      expectStatus(await call(alice, "GET", "/api/v1/user/all"), 403);
      expectStatus(await call(alice, "GET", "/api/v1/user/options"), 403);
      expectStatus(await call(alice, "GET", `/api/v1/user/${bob.id}`), 403);
      expectStatus(await call(alice, "GET", "/api/v1/profile/all"), 403);
      expectStatus(
        await call(alice, "PATCH", `/api/v1/user/setPrivileges/${alice.id}`, {
          roles: ["admin"],
          permissions: [],
        }),
        403,
      );
    });

    it("админ: списки, привилегии, обновление, удаление", async () => {
      const target = await signUp("u-target");

      expectStatus(
        await call(admin, "GET", "/api/v1/user/options?query=u-"),
        200,
      );
      expectStatus(await call(admin, "GET", `/api/v1/user/${target.id}`), 200);
      expectStatus(
        await call(admin, "GET", "/api/v1/profile/all?limit=5"),
        200,
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/setPrivileges/${target.id}`, {
          roles: ["user"],
          permissions: ["made:up"],
        }),
        400,
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/setPrivileges/${target.id}`, {
          roles: ["user"],
          permissions: ["user:view"],
        }),
        200,
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/update/${target.id}`, {
          email: alice.email,
        }),
        409,
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/profile/update/${target.id}`, {
          lastName: "Admin-set",
        }),
        200,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/profile/delete/${target.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/user/delete/${admin.id}`),
        [400, 403],
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/user/delete/${target.id}`),
        204,
      );
    });

    it("роли: у user нет прав, создание, дубль — 409, права, удаление", async () => {
      expectStatus(await call(alice, "GET", "/api/v1/roles"), 403);

      const roles = expectStatus(
        await call(admin, "GET", "/api/v1/roles"),
        200,
      );
      const list = Array.isArray(roles.data) ? roles.data : items(roles.data);

      // Базовые права пользователя VPN засеваются модулем wg-stats.
      expect(
        list
          .find((r: any) => r.name === "user")
          ?.permissions.map((p: any) => p.name)
          .sort(),
      ).to.deep.equal(["wg:peer:own", "wg:stats:own"]);

      const name = `moderator_${Date.now().toString(36)}`;
      const role = expectStatus(
        await call(admin, "POST", "/api/v1/roles", { name }),
        201,
      );

      expectStatus(await call(admin, "POST", "/api/v1/roles", { name }), 409);
      expectStatus(
        await call(
          admin,
          "PATCH",
          `/api/v1/roles/${role.data.id}/permissions`,
          {
            permissions: ["chat:manage", "message:manage"],
          },
        ),
        200,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/roles/${role.data.id}`),
        204,
      );
    });
  });

  describe("сессии", () => {
    it("список, завершение своей и чужой, terminate-others", async () => {
      const user = await signUp("u-sess");
      const second = await signIn(user.email, user.password);
      const third = await signIn(user.email, user.password);
      const list = expectStatus(
        await call(user, "GET", "/api/v1/session"),
        200,
      );

      expect(items(list.data)).to.have.length(3);
      expectStatus(
        await call(user, "DELETE", `/api/v1/session/${second.sessionId}`),
        204,
      );
      expectStatus(await call(second, "GET", "/api/v1/user/my"), 401);
      expectStatus(
        await call(user, "DELETE", `/api/v1/session/${alice.sessionId}`),
        [403, 404],
      );
      expectStatus(
        await call(user, "POST", "/api/v1/session/terminate-others"),
        204,
      );
      expectStatus(await call(third, "GET", "/api/v1/user/my"), 401);
      expectStatus(await call(user, "GET", "/api/v1/user/my"), 200);
    });
  });

  describe("аудит", () => {
    it("свои события: вход, смена сессий; общий журнал — только с правом", async () => {
      const user = await signUp("u-audit");

      await call(null, "POST", "/api/v1/auth/sign-in", {
        login: user.email,
        password: "wrong-Pass-1",
      });
      await signIn(user.email, user.password);

      const my = await eventually(
        async () => {
          const res = await call(user, "GET", "/api/v1/audit/my?limit=20");

          return items(res.data).length >= 2 ? res : undefined;
        },
        { what: "события аудита" },
      );
      const types = items(my.data).map((e: any) => e.type);

      expect(types).to.include("auth.login.succeeded");
      expectStatus(await call(user, "GET", "/api/v1/audit"), 403);
      expectStatus(
        await call(admin, "GET", `/api/v1/audit?actorId=${user.id}&limit=5`),
        200,
      );
    });
  });
});
