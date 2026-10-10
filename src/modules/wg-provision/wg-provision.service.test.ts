import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import {
  agentBinaryPath,
  buildProvisionPlan,
  buildUninstallPlan,
  REMOVE_WG_ADMIN_AGENT,
  withoutSudo,
  withSudo,
} from "./provision-plan";
import { WgProvisionService } from "./wg-provision.service";

const COMMAND =
  "curl -fsSL 'https://api.example.com/api/v1/agent-bundle/install.sh' | sudo sh -s -- --token-file '/tmp/wg-admin.x1/agent.token' --name 'node-a'";

describe("provision-plan", () => {
  it("сначала снимается служба wg-admin-agent, затем — команда установки без sudo; каталог удаляется", () => {
    const [prepare, install] = buildProvisionPlan("/tmp/wg-admin.x1", COMMAND);

    expect(prepare.command).to.equal(REMOVE_WG_ADMIN_AGENT);
    expect(prepare.command).to.include(
      "systemctl disable --now wg-admin-agent",
    );
    expect(install.command).to.include(
      "| sh -s -- --token-file '/tmp/wg-admin.x1/agent.token'",
    );
    expect(install.command).to.not.include("sudo");
    expect(install.command).to.include("rm -rf /tmp/wg-admin.x1");
    expect(install.timeoutMs).to.be.greaterThan(300_000);
  });

  it("withoutSudo меняет только запуск установщика", () => {
    expect(withoutSudo(COMMAND)).to.include("| sh -s -- --token-file");
    expect(withoutSudo("ls")).to.equal("ls");
  });

  it("withSudo оборачивает команды для не-root", () => {
    expect(withSudo("ls", "root")).to.equal("ls");
    expect(withSudo("ls", "deploy")).to.equal('sudo -n sh -c "ls"');
  });
});

describe("uninstall-plan", () => {
  it("удаление — программой экземпляра проекта с --purge", () => {
    const [step] = buildUninstallPlan("wg");

    expect(agentBinaryPath("wg")).to.equal("/opt/agent-wg/bin/agent");
    expect(step.command).to.include(
      "/opt/agent-wg/bin/agent uninstall --instance wg --purge",
    );
  });

  it("экземпляр по умолчанию — без --instance", () => {
    const [step] = buildUninstallPlan(undefined);

    expect(step.command).to.include("/opt/agent/bin/agent uninstall --purge");
  });
});

describe("WgProvisionService", () => {
  const actor = { userId: uuid2(), roles: [], permissions: [] } as any;
  let service: WgProvisionService;
  let jobs: { enqueue: sinon.SinonStub };
  let nodes: { findFor: sinon.SinonStub; setStatus: sinon.SinonStub };
  let agents: {
    issueToken: sinon.SinonStub;
    revokeToken: sinon.SinonStub;
    publicUrl: () => string;
  };

  beforeEach(() => {
    jobs = { enqueue: sinon.stub().resolves("job-1") };
    nodes = {
      findFor: sinon.stub().resolves({ id: uuid(), name: "node" }),
      setStatus: sinon.stub().resolves(),
    };
    agents = {
      issueToken: sinon.stub().resolves({
        tokenId: "t1",
        token: "prefix.secret",
        expiresAt: new Date(),
      }),
      revokeToken: sinon.stub().resolves(),
      publicUrl: () => "https://default.example.com",
    };
    service = new WgProvisionService(
      jobs as any,
      nodes as any,
      agents as any,
      { seal: (v: string) => `enc:${v}`, open: (v: string) => v } as any,
    );
  });

  it("шифрует секреты и ставит задачу с дедупликацией", async () => {
    const result = await service.provision(actor, uuid(), {
      host: "1.2.3.4",
      privateKey: "PEM",
      backendUrl: "https://api.example.com",
    });

    expect(result.jobId).to.equal("job-1");

    const [queue, data, options] = jobs.enqueue.firstCall.args;

    expect(queue).to.equal("wg.provision-node");
    expect(data.privateKeyEnc).to.equal("enc:PEM");
    expect(data.tokenEnc).to.equal("enc:prefix.secret");
    expect(data.tokenId).to.equal("t1");
    expect(JSON.stringify(data)).to.not.include('"prefix.secret"');
    expect(JSON.stringify(data)).to.not.include('"PEM"');
    expect(options.singletonKey).to.include("wg-provision:");
    // Scope — чтобы провал задачи (в т. ч. после падения воркера) снимал
    // provisioning с ноды, а прогресс доходил в комнату ноды.
    expect(options.scope).to.deep.equal({ type: "wg-node", id: uuid() });
    expect(nodes.setStatus.calledOnce).to.be.true;
    expect(nodes.findFor.firstCall.args).to.deep.equal([
      actor,
      uuid(),
      "wg:node:provision",
    ]);
  });

  it("нода недоступна актору — задача не ставится", async () => {
    nodes.findFor.rejects(Object.assign(new Error("nf"), { code: "X" }));

    try {
      await service.provision(actor, uuid(), {
        host: "1.2.3.4",
        password: "x",
        backendUrl: "https://api.example.com",
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("X");
    }
    expect(jobs.enqueue.called).to.be.false;
    expect(agents.issueToken.called).to.be.false;
  });

  it("без ключа и пароля — 400", async () => {
    try {
      await service.provision(actor, uuid(), {
        host: "1.2.3.4",
        backendUrl: "https://api.example.com",
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_AUTH_REQUIRED");
    }
  });

  it("повторная установка параллельно — 409", async () => {
    jobs.enqueue.resolves(null);

    try {
      await service.provision(actor, uuid(), {
        host: "1.2.3.4",
        password: "x",
        backendUrl: "https://api.example.com",
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_ALREADY_RUNNING");
    }
    expect(agents.revokeToken.calledOnceWith("t1")).to.be.true;
  });

  it("адрес бэкенда по умолчанию — адрес для агентов", async () => {
    await service.provision(actor, uuid(), { host: "1.2.3.4", password: "x" });

    expect(jobs.enqueue.firstCall.args[1].backendUrl).to.equal(
      "https://default.example.com",
    );
  });
});
