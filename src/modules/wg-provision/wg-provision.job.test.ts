import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid } from "../../test/helpers";
import { WgProvisionNodeJob } from "./wg-provision.job";
import { WgUninstallNodeJob } from "./wg-uninstall.job";

const WORK_DIR = "/tmp/wg-admin.Ab3dEf9h";

/** Команда установки, как её собирает `installCommand` модуля agent. */
const installCommand = (tokenFile: string, baseUrl = "http://api") =>
  `curl -fsSL '${baseUrl}/api/v1/agent-bundle/install.sh' | sudo sh -s -- --token-file '${tokenFile}' --name 'node-a'`;

const makeAgents = () => ({
  commandFor: sinon
    .stub()
    .callsFake((_node: unknown, auth: { tokenFile: string }, url: string) =>
      installCommand(auth.tokenFile, url),
    ),
  revokeToken: sinon.stub().resolves(),
  instance: () => "wg",
});

const makeNodes = () => ({
  setStatus: sinon.stub().resolves(),
  findEntity: sinon.stub().resolves({ id: uuid(), name: "node-1" }),
});

describe("WgProvisionNodeJob", () => {
  const makeRunner = () => {
    const calls: string[] = [];

    return {
      calls,
      connect: sinon.stub().resolves(),
      exec: sinon.stub().callsFake(async (command: string) => {
        calls.push(`exec:${command}`);

        return {
          code: 0,
          stdout: command.startsWith("mktemp") ? `${WORK_DIR}\n` : "",
          stderr: "",
        };
      }),
      upload: sinon.stub().callsFake(async (path: string) => {
        calls.push(`upload:${path}`);
      }),
      end: sinon.stub(),
    };
  };

  const makeCtx = () => ({
    data: {
      nodeId: uuid(),
      host: "10.0.0.1",
      port: 22,
      username: "root",
      privateKeyEnc: "key",
      passwordEnc: undefined,
      tokenEnc: "enroll-token",
      tokenId: "t1",
      backendUrl: "http://api",
    },
    progress: sinon.stub().resolves(),
    log: sinon.stub().resolves(),
  });

  it("токен — файлом в свой каталог mktemp; токена нет ни в одной команде", async () => {
    const runner = makeRunner();
    const agents = makeAgents();
    const job = new WgProvisionNodeJob(
      makeNodes() as any,
      agents as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    await job.handle(makeCtx() as any);

    const mktemp = runner.calls.findIndex(call => call.includes("mktemp -d"));
    const token = runner.calls.indexOf(`upload:${WORK_DIR}/agent.token`);
    const install = runner.calls.findIndex(call =>
      call.includes(`| sh -s -- --token-file '${WORK_DIR}/agent.token'`),
    );

    expect(mktemp).to.be.greaterThan(-1);
    expect(token).to.be.greaterThan(mktemp);
    expect(install).to.be.greaterThan(token);
    expect(runner.calls[install]).to.not.include("sudo sh");
    expect(agents.commandFor.firstCall.args[2]).to.equal("http://api");
    expect(runner.upload.firstCall.args[1].toString()).to.equal("enroll-token");

    const commands = runner.calls.filter(call => call.startsWith("exec:"));

    expect(commands.join("\n")).to.not.include("enroll-token");
    expect(commands.some(c => c.includes("wg-admin-agent.service"))).to.be.true;
    expect(runner.calls.at(-1)).to.equal(`exec:rm -rf ${WORK_DIR}`);
    expect(runner.end.calledOnce).to.be.true;
  });

  it("провал установки — токен отозван, нода в error", async () => {
    const runner = makeRunner();
    const agents = makeAgents();
    const nodes = makeNodes();

    runner.exec.callsFake(async (command: string) =>
      command.startsWith("mktemp")
        ? { code: 0, stdout: WORK_DIR, stderr: "" }
        : command.includes("agent-bundle")
          ? { code: 1, stdout: "", stderr: "boom" }
          : { code: 0, stdout: "", stderr: "" },
    );

    const job = new WgProvisionNodeJob(
      nodes as any,
      agents as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    try {
      await job.handle(makeCtx() as any);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_STEP_FAILED");
    }
    expect(agents.revokeToken.calledOnceWith("t1")).to.be.true;
    expect(nodes.setStatus.firstCall.args[1]).to.equal("error");
  });

  it("mktemp вернул неожиданный путь — установка не запускается", async () => {
    const runner = makeRunner();

    runner.exec.callsFake(async (command: string) => {
      runner.calls.push(`exec:${command}`);

      return { code: 0, stdout: "/etc; rm -rf /\n", stderr: "" };
    });

    const job = new WgProvisionNodeJob(
      makeNodes() as any,
      makeAgents() as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    try {
      await job.handle(makeCtx() as any);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_WORKDIR_FAILED");
    }
    expect(runner.upload.called).to.be.false;
    expect(runner.calls.join("\n")).to.not.include("rm -rf /etc");
  });

  it("вывод установщика — в лог задачи построчно по ходу выполнения, без повторов", async () => {
    const runner = makeRunner();
    const ctx = makeCtx();
    const logged: string[] = [];

    ctx.log.callsFake(async (line: string) => {
      logged.push(line);
    });
    runner.exec.callsFake(
      async (
        command: string,
        _timeout: number,
        onLine?: (l: string) => void,
      ) => {
        if (command.startsWith("mktemp")) {
          return { code: 0, stdout: WORK_DIR, stderr: "" };
        }
        if (!command.includes("agent-bundle")) {
          return { code: 0, stdout: "", stderr: "" };
        }
        onLine?.("▶ [0s] Зависимости");
        // Строка уже в логе, пока команда ещё выполняется.
        expect(logged).to.include("▶ [0s] Зависимости");
        onLine?.("▶ [3s] Служба systemd");

        return {
          code: 0,
          stdout: "▶ [0s] Зависимости\n▶ [3s] Служба systemd\n",
          stderr: "",
        };
      },
    );

    const job = new WgProvisionNodeJob(
      makeNodes() as any,
      makeAgents() as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    await job.handle(ctx as any);

    expect(logged.filter(line => line.includes("Зависимости"))).to.have.length(
      1,
    );
    expect(logged).to.include("▶ [3s] Служба systemd");
  });

  it("http до бэкенда — предупреждение в логе задачи", async () => {
    const runner = makeRunner();
    const job = new WgProvisionNodeJob(
      makeNodes() as any,
      makeAgents() as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );
    const ctx = makeCtx();

    ctx.data.backendUrl = "http://198.51.100.10:8182";
    await job.handle(ctx as any);

    const logged = ctx.log
      .getCalls()
      .map(call => call.args[0])
      .join("\n");

    expect(logged).to.match(/⚠.*http/);
  });
});

describe("WgUninstallNodeJob", () => {
  const data = {
    nodeId: uuid(),
    actorId: uuid(),
    host: "10.0.0.1",
    port: 22,
    username: "root",
    privateKeyEnc: "key",
  };
  const ctx = () => ({
    data,
    progress: sinon.stub().resolves(),
    log: sinon.stub().resolves(),
  });

  it("удаляет агента экземпляра проекта и отвязывает его от ноды", async () => {
    const commands: string[] = [];
    const runner = {
      connect: sinon.stub().resolves(),
      exec: sinon.stub().callsFake(async (command: string) => {
        commands.push(command);

        return {
          code: 0,
          stdout: command.startsWith("mktemp") ? WORK_DIR : "",
          stderr: "",
        };
      }),
      upload: sinon.stub().resolves(),
      end: sinon.stub(),
    };
    const agents = { detach: sinon.stub().resolves(), instance: () => "wg" };
    const job = new WgUninstallNodeJob(
      agents as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    await job.handle(ctx() as any);

    expect(runner.upload.called).to.be.false;
    expect(
      commands.some(c =>
        c.includes("/opt/agent-wg/bin/agent uninstall --instance wg --purge"),
      ),
    ).to.be.true;
    expect(agents.detach.calledOnceWith(data.nodeId, data.actorId)).to.be.true;
    expect(runner.end.calledOnce).to.be.true;
  });

  it("шаг упал — агент не отвязывается, ошибка задачи", async () => {
    const runner = {
      connect: sinon.stub().resolves(),
      exec: sinon
        .stub()
        .callsFake(async (command: string) =>
          command.startsWith("mktemp")
            ? { code: 0, stdout: WORK_DIR, stderr: "" }
            : { code: 1, stdout: "", stderr: "boom" },
        ),
      upload: sinon.stub().resolves(),
      end: sinon.stub(),
    };
    const agents = { detach: sinon.stub().resolves(), instance: () => "wg" };
    const job = new WgUninstallNodeJob(
      agents as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    try {
      await job.handle(ctx() as any);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_STEP_FAILED");
    }
    expect(agents.detach.called).to.be.false;
  });
});
