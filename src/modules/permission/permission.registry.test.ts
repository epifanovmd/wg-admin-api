import { expect } from "chai";

import { ALL_PERMISSIONS } from "../../core/auth/superuser";
import {
  definePermissions,
  getDomainPermissions,
  getPermissionCatalog,
  getRegisteredPermissions,
  PermissionError,
  unregisterPermissionDomain,
} from "./permission.registry";

const REPORT = { key: "report", label: "Отчёты" };

const expectInvalid = (fn: () => unknown) => {
  try {
    fn();
    expect.fail("should have thrown");
  } catch (err: any) {
    expect(err.code).to.equal(PermissionError.codes.INVALID_DEFINITION);
  }
};

describe("permission registry", () => {
  afterEach(() => {
    unregisterPermissionDomain("report");
    unregisterPermissionDomain("bad");
  });

  it("definePermissions возвращает имена и регистрирует права", () => {
    const perms = definePermissions("report", REPORT, {
      VIEW: { name: "report:view", label: "Просмотр" },
      ALL: { name: "report:*", label: "Всё" },
    });

    expect(perms.VIEW).to.equal("report:view");
    expect(Object.isFrozen(perms)).to.be.true;
    expect(getRegisteredPermissions()).to.include.members([
      "report:view",
      "report:*",
    ]);
  });

  it("повторное объявление идемпотентно и дополняет группу", () => {
    definePermissions("report", REPORT, {
      VIEW: { name: "report:view", label: "Просмотр" },
    });
    definePermissions("report", REPORT, {
      VIEW: { name: "report:view", label: "Просмотр отчётов" },
      EXPORT: { name: "report:export", label: "Выгрузка" },
    });

    expect(getDomainPermissions("report")).to.have.members([
      "report:view",
      "report:export",
    ]);
    expect(
      getRegisteredPermissions().filter(p => p === "report:view"),
    ).to.have.length(1);
    expect(
      getPermissionCatalog().find(g => g.key === "report")?.permissions,
    ).to.deep.equal([
      { name: "report:view", label: "Просмотр отчётов" },
      { name: "report:export", label: "Выгрузка" },
    ]);
  });

  it("каталог: первая группа — «Система» с полным доступом, дальше — объявленные", () => {
    definePermissions(
      "report",
      { key: "report:daily", label: "Ежедневные" },
      { VIEW: { name: "report:daily:view", label: "Просмотр" } },
    );

    const catalog = getPermissionCatalog();

    expect(catalog[0]).to.deep.equal({
      key: "*",
      label: "Система",
      permissions: [{ name: ALL_PERMISSIONS, label: "Полный доступ" }],
    });
    expect(catalog.find(g => g.key === "report:daily")).to.deep.equal({
      key: "report:daily",
      label: "Ежедневные",
      permissions: [{ name: "report:daily:view", label: "Просмотр" }],
    });
    expect(getRegisteredPermissions()).to.include(ALL_PERMISSIONS);
  });

  it("scoped-право объявляет вариант «только на свои»", () => {
    const perms = definePermissions("report", REPORT, {
      VIEW: { name: "report:view", label: "Просмотр", scoped: true },
      EXPORT: { name: "report:export", label: "Выгрузка" },
    });

    expect(perms.VIEW).to.equal("report:view");
    expect(getDomainPermissions("report")).to.have.members([
      "report:view",
      "report:view:own",
      "report:export",
    ]);
    expect(getRegisteredPermissions()).to.include("report:view:own");
    expect(
      getPermissionCatalog().find(g => g.key === "report")?.permissions,
    ).to.deep.equal([
      { name: "report:view", label: "Просмотр", own: "report:view:own" },
      { name: "report:export", label: "Выгрузка" },
    ]);
  });

  it("scoped-wildcard — ошибка объявления", () => {
    expectInvalid(() =>
      definePermissions("report", REPORT, {
        ALL: { name: "report:*", label: "Всё", scoped: true },
      }),
    );
  });

  it("имя с сегментом области :own — ошибка объявления", () => {
    expectInvalid(() =>
      definePermissions("report", REPORT, {
        OWN: { name: "report:view:own", label: "Свои" },
      }),
    );
    expectInvalid(() =>
      definePermissions("report", REPORT, {
        OWN: { name: "report:view:own", label: "Свои", scoped: true },
      }),
    );
  });

  it("платформенные права объявлены", () => {
    expect(getRegisteredPermissions()).to.include.members([
      "apikey:view",
      "audit:view",
    ]);
  });

  it("право вне группы или чужого домена — ошибка объявления", () => {
    expectInvalid(() =>
      definePermissions("report", REPORT, {
        X: { name: "chat:view", label: "x" },
      }),
    );
    expectInvalid(() =>
      definePermissions(
        "report",
        { key: "report:daily", label: "x" },
        { X: { name: "report:view", label: "x" } },
      ),
    );
    expectInvalid(() =>
      definePermissions(
        "report",
        { key: "chat", label: "x" },
        { X: { name: "chat:view", label: "x" } },
      ),
    );
    expect(getDomainPermissions("report")).to.be.empty;
  });

  it("некорректный домен, группа или формат — ошибка объявления", () => {
    const bad = { key: "bad", label: "x" };

    expectInvalid(() =>
      definePermissions(
        "Bad",
        { key: "Bad", label: "x" },
        {
          X: { name: "Bad:view", label: "x" },
        },
      ),
    );
    expectInvalid(() =>
      definePermissions(
        "bad",
        { key: "bad", label: " " },
        {
          X: { name: "bad:view", label: "x" },
        },
      ),
    );
    expectInvalid(() =>
      definePermissions("bad", bad, { X: { name: "bad", label: "x" } }),
    );
    expectInvalid(() =>
      definePermissions("bad", bad, { X: { name: "bad:", label: "x" } }),
    );
    expectInvalid(() =>
      definePermissions("bad", bad, {
        X: { name: `bad:${"a".repeat(100)}`, label: "x" },
      }),
    );
  });

  it("снятие домена убирает его группы и права", () => {
    definePermissions("report", REPORT, {
      VIEW: { name: "report:view", label: "Просмотр" },
    });
    unregisterPermissionDomain("report");

    expect(getRegisteredPermissions()).to.not.include("report:view");
    expect(getPermissionCatalog().some(g => g.key === "report")).to.be.false;
  });
});
