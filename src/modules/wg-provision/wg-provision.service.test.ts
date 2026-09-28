import "reflect-metadata";

import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { INSTALL_SCRIPT_TEMPLATE, renderInstallScript } from "./install-script";
import {
  buildProvisionPlan,
  buildUninstallPlan,
  withSudo,
} from "./provision-plan";
import { WgProvisionService } from "./wg-provision.service";

describe("provision-plan", () => {
  it("ключ агента — файлом (--key-file), рабочий каталог удаляется после запуска", () => {
    const [step] = buildProvisionPlan("/tmp/wg-admin.x1");

    expect(step.command).to.include(
      "sh /tmp/wg-admin.x1/install.sh --key-file /tmp/wg-admin.x1/agent.key",
    );
    expect(step.command).to.not.include("--key ");
    expect(step.command).to.include("rm -rf /tmp/wg-admin.x1");
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
          `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\nAPPARMOR_DIR=${root}/apparmor.d\n${action}`,
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
      `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\nAPPARMOR_DIR=${root}/none\nallow_apparmor && revoke_apparmor`,
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
    expect(script).to.not.include("__BACKEND_URL__");
  });

  it("спецпоследовательности replace ($&, $') в адресе подставляются как есть", () => {
    const script = renderInstallScript("https://a.example.com/$&$'");

    expect(script).to.include(`BACKEND_URL='https://a.example.com/$&$'\\'''`);
  });

  it("set -e действует внутри main: сбой команды останавливает установщик", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-main-"));
    const bin = join(root, "bin");

    mkdirSync(bin);
    writeFileSync(join(bin, "id"), "#!/bin/sh\necho 0\n", { mode: 0o755 });
    writeFileSync(
      join(bin, "systemctl"),
      '#!/bin/sh\n[ "$1" = daemon-reload ] && exit 1\nexit 0\n',
      { mode: 0o755 },
    );

    const result = spawnSync("sh", ["-s", "--", "--uninstall"], {
      input: renderInstallScript(""),
      env: { PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });

    rmSync(root, { recursive: true, force: true });
    expect(result.status).to.not.equal(0);
    expect(result.stdout).to.not.include("Агент удалён");
  });

  it("unit: перезапуск не убивает wireguard-go, нет лимита запусков, страховка отката", () => {
    const script = renderInstallScript("https://admin.example.com");

    expect(script).to.include("KillMode=process");
    expect(script).to.include("StartLimitIntervalSec=0");
    expect(script).to.include("TimeoutStopSec=120");
    expect(script).to.include("ExecStartPre=-/etc/wg-admin/boot-guard.sh");
    expect(script).to.include('write_boot_guard "$ETC/boot-guard.sh"');
  });

  it("boot-guard: новая версия, падающая до связи с бэкендом, заменяется прежней на 5-м запуске", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-guard-"));
    const guard = join(root, "boot-guard.sh");
    const bin = join(root, "agent");
    const marker = join(root, ".agent-update");
    const env = {
      PATH: "/usr/bin:/bin",
      WG_AGENT_CONFIG_DIR: root,
      WG_AGENT_BIN: bin,
    };
    const start = () => spawnSync(guard, [], { env, encoding: "utf8" });

    try {
      spawnSync("sh", [
        "-c",
        `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\nwrite_boot_guard ${guard}`,
      ]);
      writeFileSync(bin, "new");
      writeFileSync(`${bin}.prev`, "old");
      writeFileSync(marker, '{"hash":"x","attempts":0}');

      for (let i = 1; i <= 4; i += 1) {
        expect(start().status).to.equal(0);
        expect(readFileSync(bin, "utf8"), `запуск ${i}`).to.equal("new");
      }

      const fifth = start();

      expect(fifth.status).to.equal(0);
      expect(fifth.stdout).to.include("возвращена прежняя");
      expect(readFileSync(bin, "utf8")).to.equal("old");
      expect(existsSync(marker)).to.equal(false);
      expect(existsSync(`${marker}.starts`)).to.equal(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("boot-guard: без маркера обновления — ничего не трогает, счётчик сбрасывается", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-guard-"));
    const guard = join(root, "boot-guard.sh");
    const bin = join(root, "agent");

    try {
      spawnSync("sh", [
        "-c",
        `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\nwrite_boot_guard ${guard}`,
      ]);
      writeFileSync(bin, "current");
      writeFileSync(`${bin}.prev`, "old");
      writeFileSync(join(root, ".agent-update.starts"), "4");

      const result = spawnSync(guard, [], {
        env: {
          PATH: "/usr/bin:/bin",
          WG_AGENT_CONFIG_DIR: root,
          WG_AGENT_BIN: bin,
        },
      });

      expect(result.status).to.equal(0);
      expect(readFileSync(bin, "utf8")).to.equal("current");
      expect(existsSync(join(root, ".agent-update.starts"))).to.equal(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--key-file: ключ читается из файла без пробелов и переводов строк; нет файла — ошибка", () => {
    const root = mkdtempSync(join(tmpdir(), "wg-key-"));
    const keyFile = join(root, "agent.key");
    const parse = (args: string) =>
      spawnSync(
        "sh",
        [
          "-c",
          `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\nparse_args ${args}\nprintf '%s' "$KEY"`,
        ],
        { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" },
      );

    try {
      writeFileSync(keyFile, "prefix.secret\r\n");

      const ok = parse(`--key-file ${keyFile}`);

      expect(ok.status, ok.stderr).to.equal(0);
      expect(ok.stdout).to.equal("prefix.secret");

      const missing = parse(`--key-file ${root}/none`);

      expect(missing.status).to.not.equal(0);
      expect(missing.stderr).to.include("Файл ключа не читается");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("WG_ADMIN_INSTALL_LIB=1 — только функции, установка не запускается", () => {
    const result = spawnSync(
      "sh",
      [
        "-c",
        `WG_ADMIN_INSTALL_LIB=1\n. ${INSTALL_SCRIPT_TEMPLATE}\ntype install_agent >/dev/null && echo loaded`,
      ],
      { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" },
    );

    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout.trim()).to.equal("loaded");
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
      script.indexOf("uninstall_agent() {"),
      script.indexOf("\ninstall_agent() {"),
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
    const [step] = buildUninstallPlan("/tmp/wg-admin.x1");

    expect(step.command).to.include(
      "sh /tmp/wg-admin.x1/install.sh --uninstall",
    );
  });
});
