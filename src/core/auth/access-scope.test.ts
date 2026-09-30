import "reflect-metadata";

import { expect } from "chai";

import type { AuthContext } from "../../types/koa";
import { OwnedAccess, resolveScope } from "./access-scope";

interface IItem {
  ownerId: string | null;
  createdById: string | null;
}

const actor = (permissions: string[], roles: string[] = []): AuthContext => ({
  userId: "u1",
  sessionId: "s1",
  roles,
  permissions,
  emailVerified: true,
});

const access = new OwnedAccess<IItem>({
  owner: "ownerId",
  creator: "createdById",
});

describe("resolveScope", () => {
  it("all — право, wildcard или суперпользователь", () => {
    expect(resolveScope([], ["x:update"], "x:update")).to.equal("all");
    expect(resolveScope([], ["x:*"], "x:update")).to.equal("all");
    expect(resolveScope(["admin"], [], "x:update")).to.equal("all");
    expect(resolveScope([], ["*"], "x:update")).to.equal("all");
  });

  it("own — только право «на свои»", () => {
    expect(resolveScope([], ["x:update:own"], "x:update")).to.equal("own");
  });

  it("null — права нет", () => {
    expect(resolveScope([], ["x:view"], "x:update")).to.equal(null);
  });
});

describe("OwnedAccess", () => {
  const own = { ownerId: "u1", createdById: null };
  const created = { ownerId: "u2", createdById: "u1" };
  const foreign = { ownerId: "u2", createdById: "u3" };

  it("своя — владелец или создатель", () => {
    expect(access.isOwn("u1", own)).to.be.true;
    expect(access.isOwn("u1", created)).to.be.true;
    expect(access.isOwn("u1", foreign)).to.be.false;
  });

  it("can: all — любая, own — только своя", () => {
    expect(access.can(actor(["x:update"]), "x:update", foreign)).to.be.true;
    expect(access.can(actor(["x:update:own"]), "x:update", created)).to.be.true;
    expect(access.can(actor(["x:update:own"]), "x:update", foreign)).to.be
      .false;
    expect(access.can(actor([]), "x:update", own)).to.be.false;
  });

  it("filter: все, свои или ничего", () => {
    expect(access.filter(actor(["x:view"]), "x:view")).to.deep.equal({});
    expect(access.filter(actor(["x:view:own"]), "x:view")).to.deep.equal({
      ownedBy: "u1",
    });
    expect(access.filter(actor([]), "x:view")).to.equal(null);
  });

  it("условия «своих» для выборок", () => {
    expect(access.ownedCondition("item")).to.equal(
      "(item.ownerId = :ownedBy OR item.createdById = :ownedBy)",
    );
    expect(access.ownedWhere("u1")).to.deep.equal([
      { ownerId: "u1" },
      { createdById: "u1" },
    ]);
  });
});
