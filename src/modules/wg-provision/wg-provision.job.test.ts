import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid } from "../../test/helpers";
import { INSTALL_SCRIPT_PATH } from "./provision-plan";
import { WgProvisionNodeJob } from "./wg-provision.job";
import { WgUninstallNodeJob } from "./wg-uninstall.job";

describe("WgProvisionNodeJob", () => {
  const makeRunner = () => {
    const calls: string[] = [];

    return {
      calls,
      connect: sinon.stub().resolves(),
      exec: sinon.stub().callsFake(async (command: string) => {
        calls.push(`exec:${command}`);

        return { code: 0, stdout: "", stderr: "" };
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
      agentKeyEnc: "agent-key",
      backendUrl: "http://api",
    },
    progress: sinon.stub().resolves(),
    log: sinon.stub().resolves(),
  });

  it("загружает установщик с адресом бэкенда и запускает его с ключом агента", async () => {
    const runner = makeRunner();
    const job = new WgProvisionNodeJob(
      { setStatus: sinon.stub().resolves() } as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    await job.handle(makeCtx() as any);

    const upload = runner.calls.indexOf(`upload:${INSTALL_SCRIPT_PATH}`);
    const install = runner.calls.findIndex(call =>
      call.includes(`sh ${INSTALL_SCRIPT_PATH} --key`),
    );

    expect(upload).to.be.greaterThan(-1);
    expect(install).to.be.greaterThan(upload);
    expect(runner.upload.firstCall.args[1].toString()).to.include(
      "BACKEND_URL='http://api'",
    );
    expect(runner.calls.join("\n")).to.not.include("agent-key");
    expect(runner.end.calledOnce).to.be.true;
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
        _command: string,
        _timeout: number,
        onLine?: (l: string) => void,
      ) => {
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
      { setStatus: sinon.stub().resolves() } as any,
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
      { setStatus: sinon.stub().resolves() } as any,
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

  it("выполняет план удаления и отвязывает агента от ноды", async () => {
    const commands: string[] = [];
    const runner = {
      connect: sinon.stub().resolves(),
      exec: sinon.stub().callsFake(async (command: string) => {
        commands.push(command);

        return { code: 0, stdout: "", stderr: "" };
      }),
      upload: sinon.stub().resolves(),
      end: sinon.stub(),
    };
    const nodes = { detachAgent: sinon.stub().resolves() };
    const job = new WgUninstallNodeJob(
      nodes as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    await job.handle(ctx() as any);

    expect(runner.upload.firstCall.args[0]).to.equal(INSTALL_SCRIPT_PATH);
    expect(commands.some(c => c.includes("--uninstall"))).to.be.true;
    expect(nodes.detachAgent.calledOnceWith(data.nodeId, data.actorId)).to.be
      .true;
    expect(runner.end.calledOnce).to.be.true;
  });

  it("шаг упал — агент не отвязывается, ошибка задачи", async () => {
    const runner = {
      connect: sinon.stub().resolves(),
      exec: sinon.stub().resolves({ code: 1, stdout: "", stderr: "boom" }),
      upload: sinon.stub().resolves(),
      end: sinon.stub(),
    };
    const nodes = { detachAgent: sinon.stub().resolves() };
    const job = new WgUninstallNodeJob(
      nodes as any,
      { open: (v: string) => v } as any,
      () => runner as any,
    );

    try {
      await job.handle(ctx() as any);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_STEP_FAILED");
    }
    expect(nodes.detachAgent.called).to.be.false;
  });
});
