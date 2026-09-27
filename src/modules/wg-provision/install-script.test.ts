import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";

import { HOST_STATE_FUNCTIONS } from "./install-script";

/**
 * Системные утилиты, которые видит скрипт в песочнице. Остальное в PATH не
 * попадает: настоящие docker, apt-get, systemctl машины, где идут тесты
 * (например, раннера CI), меняли бы поведение установщика.
 */
const SYSTEM_TOOLS = [
  "cat",
  "comm",
  "cp",
  "cut",
  "dirname",
  "grep",
  "head",
  "mkdir",
  "mktemp",
  "mv",
  "rm",
  "rmdir",
  "sed",
  "sort",
  "tail",
  "touch",
  "tr",
  "uniq",
  "wc",
];

/**
 * Хост-песочница: пакетная база dpkg, sysctl и модули ядра — файлы во
 * временном каталоге, команды — заглушки и отобранные системные утилиты в PATH.
 */
const makeHost = (opts: {
  installed: string[];
  forward: string;
  docker?: boolean;
  required?: string[];
}) => {
  const root = mkdtempSync(join(tmpdir(), "wg-host-"));
  const bin = join(root, "bin");
  const db = join(root, "dpkg.db");
  const stub = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  mkdirSync(bin);

  const tools = join(root, "tools");

  mkdirSync(tools);
  for (const tool of SYSTEM_TOOLS) {
    const path = ["/usr/bin", "/bin"]
      .map(dir => join(dir, tool))
      .find(candidate => existsSync(candidate));

    if (path) symlinkSync(path, join(tools, tool));
  }
  mkdirSync(join(root, "sysctl"));
  mkdirSync(join(root, "modules"));
  writeFileSync(db, opts.installed.map(p => `${p}\n`).join(""));
  writeFileSync(join(root, "required"), (opts.required ?? []).join("\n"));
  writeFileSync(join(root, "sysctl", "net.ipv4.ip_forward"), opts.forward);
  writeFileSync(
    join(root, "sysctl", "net.ipv6.conf.all.forwarding"),
    opts.forward,
  );

  stub(
    "dpkg-query",
    `pkg=""; for a in "$@"; do case "$a" in -*) ;; *) pkg="$a" ;; esac; done
if [ -n "$pkg" ]; then grep -qx "$pkg" ${db} && printf 'install ok installed'; exit 0; fi
cat ${db}`,
  );
  stub(
    "apt-get",
    `echo "$*" >> ${root}/apt.log
[ "$1" = update ] && exit 0
for a in "$@"; do case "$a" in -*|install) ;; *) echo "$a" >> ${db}
  [ "$a" = wireguard-tools ] && echo libwg >> ${db} ;; esac; done
exit 0`,
  );
  stub(
    "dpkg",
    `pkg="$2"
grep -qx "$pkg" ${root}/required && exit 1
[ "$pkg" = libwg ] && grep -qx wireguard-tools ${db} && exit 1
grep -vx "$pkg" ${db} > ${db}.new; mv ${db}.new ${db}`,
  );
  stub(
    "sysctl",
    `case "$1" in
  -n) cat ${root}/sysctl/$2 ;;
  -qw) printf '%s' "\${2#*=}" > ${root}/sysctl/\${2%%=*} ;;
  -q) grep = "$3" | while IFS='=' read -r k v; do printf '%s' "$v" > ${root}/sysctl/$k; done ;;
esac`,
  );
  stub(
    "modprobe",
    `if [ "$1" = -r ]; then rmdir ${root}/modules/$2; else mkdir -p ${root}/modules/$1; fi`,
  );
  stub(
    "systemctl",
    `[ "$1 $3" = "is-active docker" ] && [ -f ${root}/docker-active ]`,
  );
  if (opts.docker) {
    stub("docker", "exit 0");
    writeFileSync(join(root, "docker-active"), "");
  }

  const run = (commands: string) => {
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        `set -eu
log() { echo "$*"; }
${HOST_STATE_FUNCTIONS}
INSTALL_STATE=${root}/etc/install-state
SYSCTL_CONF=${root}/99-wg-admin.conf
MODULES_DIR=${root}/modules
detect_pm
${commands}`,
      ],
      { env: { PATH: `${bin}:${tools}` }, encoding: "utf8" },
    );

    expect(result.status, result.stderr + result.stdout).to.equal(0);

    return result.stdout;
  };

  const packages = () =>
    readFileSync(db, "utf8").split("\n").filter(Boolean).sort();
  const sysctl = (key: string) =>
    readFileSync(join(root, "sysctl", key), "utf8");
  const aptCalls = () =>
    existsSync(join(root, "apt.log"))
      ? readFileSync(join(root, "apt.log"), "utf8")
      : "";

  return {
    root,
    run,
    packages,
    sysctl,
    aptCalls,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const INSTALL =
  "ensure_packages $(agent_packages); ensure_modules; enable_forwarding";
const BASE = ["ca-certificates", "curl", "iproute2", "iputils-ping"];

describe("установщик: журнал изменений хоста", () => {
  it("удаление возвращает хост к состоянию до первой установки", () => {
    const host = makeHost({ installed: BASE, forward: "0" });

    try {
      host.run(INSTALL);
      expect(host.packages()).to.include.members([
        "wireguard-tools",
        "libwg",
        "iptables",
        "conntrack",
      ]);
      expect(host.sysctl("net.ipv4.ip_forward")).to.equal("1");
      expect(existsSync(join(host.root, "modules", "wireguard"))).to.equal(
        true,
      );

      // Повторная установка: всё на месте — без apt, журнал не перезаписан.
      const aptBefore = host.aptCalls();

      host.run(INSTALL);
      expect(host.aptCalls()).to.equal(aptBefore);
      expect(
        readFileSync(join(host.root, "etc", "install-state"), "utf8"),
      ).to.include("IPV4_FORWARD=0");

      host.run("revert_install");
      expect(host.packages()).to.deep.equal([...BASE].sort());
      expect(host.sysctl("net.ipv4.ip_forward")).to.equal("0");
      expect(host.sysctl("net.ipv6.conf.all.forwarding")).to.equal("0");
      expect(existsSync(join(host.root, "modules", "wireguard"))).to.equal(
        false,
      );
      expect(existsSync(join(host.root, "99-wg-admin.conf"))).to.equal(false);
    } finally {
      host.cleanup();
    }
  });

  it("что было до установки — не трогается", () => {
    const host = makeHost({
      installed: [...BASE, "wireguard-tools", "libwg", "iptables", "conntrack"],
      forward: "1",
    });

    mkdirSync(join(host.root, "modules", "wireguard"));
    try {
      host.run(INSTALL);
      expect(host.aptCalls()).to.equal("");
      host.run("revert_install");
      expect(host.packages()).to.include.members([
        "wireguard-tools",
        "iptables",
      ]);
      expect(host.sysctl("net.ipv4.ip_forward")).to.equal("1");
      expect(existsSync(join(host.root, "modules", "wireguard"))).to.equal(
        true,
      );
    } finally {
      host.cleanup();
    }
  });

  it("Docker на хосте: ip_forward и iptables остаются; нужный другим пакет — тоже", () => {
    const host = makeHost({
      installed: BASE,
      forward: "0",
      docker: true,
      required: ["conntrack"],
    });

    try {
      host.run(INSTALL);

      const out = host.run("revert_install");

      expect(host.sysctl("net.ipv4.ip_forward")).to.equal("1");
      expect(host.packages()).to.include.members(["iptables", "conntrack"]);
      expect(host.packages()).to.not.include("wireguard-tools");
      expect(out).to.include("Docker");
      expect(out).to.include("conntrack оставлен");
    } finally {
      host.cleanup();
    }
  });

  it("без журнала — удаляется только своё: файл sysctl", () => {
    const host = makeHost({ installed: BASE, forward: "1" });

    writeFileSync(
      join(host.root, "99-wg-admin.conf"),
      "net.ipv4.ip_forward=1\n",
    );
    try {
      host.run("revert_install");
      expect(existsSync(join(host.root, "99-wg-admin.conf"))).to.equal(false);
      expect(host.sysctl("net.ipv4.ip_forward")).to.equal("1");
      expect(host.packages()).to.deep.equal([...BASE].sort());
    } finally {
      host.cleanup();
    }
  });
});
