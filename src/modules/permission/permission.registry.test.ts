import { expect } from "chai";

import {
  definePermissions,
  getDomainPermissions,
  getRegisteredPermissions,
  PermissionError,
  unregisterPermissionDomain,
} from "./permission.registry";
import { Permissions } from "./permission.types";

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

  it("definePermissions возвращает объявление и регистрирует права", () => {
    const perms = definePermissions("report", {
      VIEW: "report:view",
      ALL: "report:*",
    });

    expect(perms.VIEW).to.equal("report:view");
    expect(Object.isFrozen(perms)).to.be.true;
    expect(getRegisteredPermissions()).to.include.members([
      "report:view",
      "report:*",
    ]);
  });

  it("повторное объявление идемпотентно и дополняет домен", () => {
    definePermissions("report", { VIEW: "report:view" });
    definePermissions("report", {
      VIEW: "report:view",
      EXPORT: "report:export",
    });

    expect(getDomainPermissions("report")).to.have.members([
      "report:view",
      "report:export",
    ]);
    expect(
      getRegisteredPermissions().filter(p => p === "report:view"),
    ).to.have.length(1);
  });

  it("реестр включает совместимый справочник Permissions и «*»", () => {
    const all = getRegisteredPermissions();

    expect(all).to.include(Permissions.ALL);
    expect(all).to.include.members(Object.values(Permissions));
  });

  it("платформенные права объявлены", () => {
    expect(getRegisteredPermissions()).to.include.members([
      "apikey:manage",
      "audit:view",
    ]);
  });

  it("право чужого домена — ошибка объявления", () => {
    expectInvalid(() => definePermissions("report", { X: "chat:view" }));
    expect(getDomainPermissions("report")).to.be.empty;
  });

  it("некорректный домен или формат — ошибка объявления", () => {
    expectInvalid(() => definePermissions("Bad", { X: "Bad:view" }));
    expectInvalid(() => definePermissions("bad", { X: "bad" }));
    expectInvalid(() => definePermissions("bad", { X: "bad:" }));
    expectInvalid(() =>
      definePermissions("bad", { X: `bad:${"a".repeat(100)}` }),
    );
  });

  it("снятие домена убирает его права", () => {
    definePermissions("report", { VIEW: "report:view" });
    unregisterPermissionDomain("report");

    expect(getRegisteredPermissions()).to.not.include("report:view");
  });
});
