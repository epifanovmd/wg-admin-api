import "reflect-metadata";

import { expect } from "chai";

import { hasPermission, isSuperUserGrant } from "./has-permission";
import { ALL_PERMISSIONS, SUPERUSER_ROLE } from "./superuser";

describe("hasPermission", () => {
  it("exact match returns true", () => {
    expect(hasPermission(["user:view"], "user:view")).to.be.true;
  });

  it("* permission matches everything", () => {
    expect(hasPermission(["*"], "user:view")).to.be.true;
    expect(hasPermission(["*"], "chat:manage")).to.be.true;
    expect(hasPermission(["*"], "wg:server:view")).to.be.true;
  });

  it("user:* matches user:view", () => {
    expect(hasPermission(["user:*"], "user:view")).to.be.true;
  });

  it("user:* matches user:manage", () => {
    expect(hasPermission(["user:*"], "user:manage")).to.be.true;
  });

  it("chat:* does NOT match user:view", () => {
    expect(hasPermission(["chat:*"], "user:view")).to.be.false;
  });

  it("wg:server:* matches wg:server:view", () => {
    expect(hasPermission(["wg:server:*"], "wg:server:view")).to.be.true;
  });

  it("wg:* matches wg:server:view (higher-level wildcard)", () => {
    expect(hasPermission(["wg:*"], "wg:server:view")).to.be.true;
  });

  it("no permissions returns false", () => {
    expect(hasPermission([], "user:view")).to.be.false;
  });

  it("empty required permission returns false (no match in empty list)", () => {
    expect(hasPermission(["user:view"], "")).to.be.false;
  });

  it("multiple permissions, one matches", () => {
    expect(hasPermission(["chat:view", "user:*"], "user:manage")).to.be.true;
  });

  it("multiple permissions, none match", () => {
    expect(hasPermission(["chat:view", "chat:manage"], "user:view")).to.be
      .false;
  });

  it("wildcard does not match different prefix", () => {
    expect(hasPermission(["message:*"], "chat:view")).to.be.false;
  });

  it("exact match with multi-segment permission", () => {
    expect(hasPermission(["wg:server:view"], "wg:server:view")).to.be.true;
  });
});

describe("isSuperUserGrant", () => {
  it("grants the superuser role or the all-permissions wildcard", () => {
    expect(isSuperUserGrant([SUPERUSER_ROLE], [])).to.be.true;
    expect(isSuperUserGrant([], [ALL_PERMISSIONS])).to.be.true;
    expect(isSuperUserGrant(["user"], ["user:*"])).to.be.false;
  });
});
