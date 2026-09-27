import "reflect-metadata";

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import { APPARMOR_FUNCTIONS, renderInstallScript } from "./install-script";
import {
  buildProvisionPlan,
  buildUninstallPlan,
  INSTALL_SCRIPT_PATH,
  withSudo,
} from "./provision-plan";
import { WgProvisionService } from "./wg-provision.service";

describe("provision-plan", () => {
  it("ключ агента — только в base64, установщик удаляется после запуска", () => {
    const [step] = buildProvisionPlan({ agentKey: "prefix.k'; rm -rf /" });

    expect(step.command).to.not.include("rm -rf /");
    expect(step.command).to.include("base64 -d");
    expect(step.command).to.include(`sh ${INSTALL_SCRIPT_PATH} --key`);
    expect(step.command).to.include(`rm -f ${INSTALL_SCRIPT_PATH}`);
    // Без сборки образа на хосте: бинарь скачивается готовым.
    expect(step.command).to.not.include("docker build");
    expect(step.timeoutMs).to.be.greaterThan(300_000);
  });

  it("withSudo оборачивает команды для не-root", () => {
    expect(withSudo("ls", "root")).to.equal("ls");
    expect(withSudo("ls", "deploy")).to.equal('sudo -n sh -c "ls"');
  });
});

describe("renderInstallScript", () => {
  // Ubuntu 24.10+: профили AppArmor wg и wg-quick читают конфиги только из
  // /etc/wireguard — wg-quick up из каталога агента падал с Permission denied.
  it("AppArmor: каталог агента разрешается профилям wg/wg-quick и убирается при удалении", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-aa-"));
    const bin = join(root, "bin");

    mkdirSync(join(root, "apparmor.d"), { recursive: true });
    mkdirSync(bin);
    writeFileSync(
      join(root, "apparmor.d", "wg-quick"),
      "profile wg-quick {\n  include if exists <local/wg-quick>\n}\n",
    );
    writeFileSync(
      join(root, "apparmor.d", "wg"),
      "profile wg {\n  include if exists <local/wg>\n}\n",
    );
    writeFileSync(
      join(bin, "apparmor_parser"),
      `#!/bin/sh\necho "$@" >> ${join(root, "reloaded")}\n`,
      { mode: 0o755 },
    );

    const run = (action: string) =>
      spawnSync(
        "sh",
        [
          "-c",
          `${APPARMOR_FUNCTIONS}\nAPPARMOR_DIR=${root}/apparmor.d\n${action}`,
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` } },
      );

    expect(run("allow_apparmor; allow_apparmor").status).to.equal(0);

    const local = readFileSync(join(root, "apparmor.d/local/wg-quick"), "utf8");

    expect(local).to.include("/etc/wg-admin/wireguard/** r,");
    // Повторная установка не дублирует правило.
    expect(local.match(/wg-admin begin/g)).to.have.length(1);
    expect(readFileSync(join(root, "apparmor.d/local/wg"), "utf8")).to.include(
      "/etc/wg-admin/wireguard/** r,",
    );
    expect(readFileSync(join(root, "reloaded"), "utf8")).to.include("wg-quick");

    writeFileSync(
      join(root, "apparmor.d/local/wg-quick"),
      `/srv/own r,\n${local}`,
    );
    expect(run("revoke_apparmor").status).to.equal(0);
    expect(
      readFileSync(join(root, "apparmor.d/local/wg-quick"), "utf8"),
    ).to.equal("/srv/own r,\n");
    rmSync(root, { recursive: true, force: true });
  });

  it("AppArmor: без профилей — ничего не делает", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-aa-"));
    const result = spawnSync("sh", [
      "-c",
      `${APPARMOR_FUNCTIONS}\nAPPARMOR_DIR=${root}/none\nallow_apparmor && revoke_apparmor`,
    ]);

    expect(result.status).to.equal(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("корректный sh, адрес бэкенда подставлен и экранирован", () => {
    const script = renderInstallScript("https://admin.example.com'; rm -rf /");
    const syntax = spawnSync("sh", ["-n"], { input: script });

    expect(syntax.status, syntax.stderr.toString()).to.equal(0);
    expect(script).to.include(
      `BACKEND_URL='https://admin.example.com'\\''; rm -rf /'`,
    );
  });

  it("бинарь — по ключу агента с проверкой sha256; служба systemd; удаление откатывает хост", () => {
    const script = renderInstallScript("https://admin.example.com");

    expect(script).to.include('-H "X-Api-Key: $KEY"');
    expect(script).to.include("/api/v1/wg-agent/binary/$ARCH");
    expect(script).to.include("x-agent-sha256:");
    expect(script).to.include("sha256sum");
    expect(script).to.include("Restart=always");
    expect(script).to.include("--uninstall");
    const uninstall = script.slice(
      script.indexOf('if [ "$ACTION" = uninstall ]'),
      script.indexOf("exit 0"),
    );

    expect(uninstall).to.include("cleanup");
    expect(uninstall).to.include("revert_install");
  });
});

describe("WgProvisionService", () => {
  let service: WgProvisionService;
  let jobs: { enqueue: sinon.SinonStub };
  let nodes: {
    findEntity: sinon.SinonStub;
    rotateAgentKey: sinon.SinonStub;
    setStatus: sinon.SinonStub;
  };

  beforeEach(() => {
    jobs = { enqueue: sinon.stub().resolves("job-1") };
    nodes = {
      findEntity: sinon.stub().resolves({ id: uuid(), name: "node" }),
      rotateAgentKey: sinon.stub().resolves({ agentKey: "prefix.secret" }),
      setStatus: sinon.stub().resolves(),
    };
    service = new WgProvisionService(
      jobs as any,
      nodes as any,
      { seal: (v: string) => `enc:${v}`, open: (v: string) => v } as any,
    );
  });

  it("шифрует секреты и ставит задачу с дедупликацией", async () => {
    const result = await service.provision(uuid2(), uuid(), {
      host: "1.2.3.4",
      privateKey: "PEM",
      backendUrl: "https://api.example.com",
    });

    expect(result.jobId).to.equal("job-1");

    const [queue, data, options] = jobs.enqueue.firstCall.args;

    expect(queue).to.equal("wg.provision-node");
    expect(data.privateKeyEnc).to.equal("enc:PEM");
    expect(data.agentKeyEnc).to.equal("enc:prefix.secret");
    expect(JSON.stringify(data)).to.not.include('"PEM"');
    expect(options.singletonKey).to.include("wg-provision:");
    // Scope — чтобы провал задачи (в т. ч. после падения воркера) снимал
    // provisioning с ноды, а прогресс доходил в комнату ноды.
    expect(options.scope).to.deep.equal({ type: "wg-node", id: uuid() });
    expect(nodes.setStatus.calledOnce).to.be.true;
  });

  it("без ключа и пароля — 400", async () => {
    try {
      await service.provision(uuid2(), uuid(), {
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
      await service.provision(uuid2(), uuid(), {
        host: "1.2.3.4",
        password: "x",
        backendUrl: "https://api.example.com",
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PROVISION_ALREADY_RUNNING");
    }
  });
});

describe("uninstall-plan", () => {
  it("удаление — тем же установщиком с --uninstall", () => {
    const [step] = buildUninstallPlan();

    expect(step.command).to.include(`sh ${INSTALL_SCRIPT_PATH} --uninstall`);
  });
});
