import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgNodeAgentService } from "./wg-node-agent.service";

describe("WgNodeAgentService: установка и выдача агента ноды", () => {
  let nodes: { findFor: sinon.SinonStub };
  let agents: { installCommand: sinon.SinonStub };
  let enrollment: Record<string, sinon.SinonStub>;
  let issue: Record<string, sinon.SinonStub>;
  let service: WgNodeAgentService;
  const actor = { userId: "u1" } as any;

  beforeEach(() => {
    nodes = {
      findFor: sinon.stub().resolves({ id: "n1", name: "нода-1" }),
    };
    agents = {
      installCommand: sinon
        .stub()
        .callsFake(async (body: any) => `curl … --token ${body.token}`),
    };
    enrollment = {
      createToken: sinon.stub().resolves({
        enrollmentToken: { id: "t1" },
        token: "pref.secret",
      }),
      revokeToken: sinon.stub().resolves(),
    };
    issue = {
      env: sinon.stub().resolves({
        env: "AGENT_SERVER_URL=…\n",
        token: "pref.secret",
        tokenId: "t1",
        expiresAt: new Date(1000),
      }),
      archive: sinon.stub().resolves({
        file: "agent-prod-1.0.0.tar.gz",
        data: Buffer.from("x"),
        tokenId: "t1",
        expiresAt: new Date(1000),
      }),
      link: sinon.stub().resolves({
        id: "i1",
        url: "https://api.example.com/agent/v1/bundle/issued/i1",
        expiresAt: new Date(2000),
      }),
    };
    service = new WgNodeAgentService(
      nodes as any,
      agents as any,
      {} as any,
      enrollment as any,
      issue as any,
    );
  });

  it("команда установки: токен с меткой ноды, имя ноды; docker — способ передаётся", async () => {
    const res = await service.installCommand(actor, "n1", {});

    expect(res).to.include({ token: "pref.secret", tokenId: "t1" });
    expect(enrollment.createToken.firstCall.args[1]).to.deep.include({
      labels: { nodeId: "n1" },
      maxUses: 1,
    });
    expect(agents.installCommand.firstCall.args[0]).to.deep.equal({
      token: "pref.secret",
      name: "нода-1",
    });

    await service.installCommand(actor, "n1", { mode: "docker" });
    expect(agents.installCommand.secondCall.args[0]).to.include({
      mode: "docker",
      name: "нода-1",
    });
  });

  it("команда не собрана (нет compose.yml в архиве) — токен отзывается", async () => {
    agents.installCommand.rejects(new Error("нет compose.yml"));

    const err = await service
      .installCommand(actor, "n1", { mode: "docker" })
      .catch((e: Error) => e);

    expect((err as Error).message).to.equal("нет compose.yml");
    expect(enrollment.revokeToken.calledOnceWith("t1")).to.equal(true);
  });

  it("выдача: метка ноды, одноразовый токен, имя — заданное или имя ноды; права агента ноды", async () => {
    expect(await service.issueEnv(actor, "n1", {})).to.deep.include({
      token: "pref.secret",
      expiresAt: 1000,
    });
    expect(issue.env.firstCall.args[1]).to.deep.equal({
      tokenName: "wg-node:нода-1",
      name: "нода-1",
      labels: { nodeId: "n1" },
      maxUses: 1,
      tokenTtlMinutes: 24 * 60,
      server: undefined,
    });
    expect(nodes.findFor.firstCall.args[2]).to.equal("wg:node:agent");

    expect(
      await service.issueArchive(actor, "n1", { name: "свой" }),
    ).to.deep.equal({
      file: "agent-prod-1.0.0.tar.gz",
      data: Buffer.from("x"),
    });
    expect(issue.archive.firstCall.args[1].name).to.equal("свой");

    expect(
      await service.issueLink(actor, "n1", { linkExpiresInMinutes: 60 }),
    ).to.deep.equal({
      url: "https://api.example.com/agent/v1/bundle/issued/i1",
      expiresAt: 2000,
    });
    expect(issue.link.firstCall.args[2]).to.equal(60);
  });
});
