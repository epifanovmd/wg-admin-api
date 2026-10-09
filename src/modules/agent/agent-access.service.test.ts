import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  AgentAccessService,
  IAgentAccessPolicy,
  inScope,
} from "./agent-access.service";

const user = (permissions: string[] = []) => ({
  userId: "u1",
  roles: ["user"],
  permissions,
});

/** Политика: доступ на просмотр к a1 и a2, на управление — только к a1. */
const policy = (): IAgentAccessPolicy => ({
  canAccess: sinon
    .stub()
    .callsFake(async (_actor, agentId, action) =>
      action === "view" ? ["a1", "a2"].includes(agentId) : agentId === "a1",
    ),
  agentIds: sinon
    .stub()
    .callsFake(async (_actor, action) =>
      action === "view" ? ["a1", "a2"] : ["a1"],
    ),
});

describe("AgentAccessService", () => {
  it("право модуля — все агенты без политик", async () => {
    const access = new AgentAccessService({} as any, []);
    const viewer = user(["agent:view"]);

    expect(await access.can(viewer, "any", "view")).to.equal(true);
    expect(await access.scope(viewer, "view")).to.equal("all");
    expect(access.hasAll(viewer, "manage")).to.equal(false);
  });

  it("без права и политик — 403 на список, 404 на агента", async () => {
    const access = new AgentAccessService({} as any, []);

    await access.scope(user(), "view").then(
      () => expect.fail("должно было упасть"),
      (err: any) => expect(err.code).to.equal("AGENT_FORBIDDEN"),
    );
    await access.require(user(), "a1", "view").then(
      () => expect.fail("должно было упасть"),
      (err: any) => expect(err.code).to.equal("AGENT_NOT_FOUND"),
    );
  });

  it("политика: видимый без права на действие — 403, невидимый — 404", async () => {
    const access = new AgentAccessService({} as any, [policy()]);

    await access.require(user(), "a1", "manage");
    await access.require(user(), "a2", "manage").then(
      () => expect.fail("должно было упасть"),
      (err: any) => expect(err.code).to.equal("AGENT_FORBIDDEN"),
    );
    await access.require(user(), "a3", "manage").then(
      () => expect.fail("должно было упасть"),
      (err: any) => expect(err.code).to.equal("AGENT_NOT_FOUND"),
    );

    const scope = await access.scope(user(), "view");

    expect(inScope(scope, "a2")).to.equal(true);
    expect(inScope(scope, "a3")).to.equal(false);
    expect(inScope("all", undefined)).to.equal(true);
  });

  it("действие без агента — только с правом модуля", () => {
    const access = new AgentAccessService({} as any, [policy()]);

    access.requireAll(user(["agent:config"]), "config");
    expect(() => access.requireAll(user(), "config")).to.throw(
      /укажите агента/,
    );
  });

  it("комната: права пользователя — из БД", async () => {
    const grants = {
      grantOf: sinon.stub().resolves({ roles: [], permissions: [] }),
    };
    const access = new AgentAccessService(grants as any, [policy()]);

    expect(await access.canUser("u1", "a2", "view")).to.equal(true);
    expect(await access.canUser("u1", "a3", "view")).to.equal(false);
    expect(grants.grantOf.calledWith("u1")).to.equal(true);
  });
});
