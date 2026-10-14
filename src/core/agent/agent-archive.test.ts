import { expect } from "chai";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { agentEnvText, appendToTarGz, isInsecureServer } from "./agent-archive";
import { agentInstallCommand } from "./agent-files";

/** Архив как у `agent pack`: папка agent/ с программой и настройками. */
const packArchive = (): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), "agent-archive-"));

  mkdirSync(join(dir, "agent"));
  writeFileSync(join(dir, "agent", "agent"), "#!/bin/sh\n");
  writeFileSync(join(dir, "agent", "compose.yml"), "services: {}\n");
  execFileSync("tar", ["-czf", join(dir, "a.tar.gz"), "-C", dir, "agent"]);

  return readFileSync(join(dir, "a.tar.gz"));
};

describe("архив агента с .env", () => {
  it("файл дописывается в конец архива с правами 0600, прежние записи на месте", () => {
    const out = appendToTarGz(packArchive(), "agent/.env", "A=1\n", 0o600);
    const dir = mkdtempSync(join(tmpdir(), "agent-archive-x-"));
    const file = join(dir, "out.tar.gz");

    writeFileSync(file, out);
    const list = execFileSync("tar", ["-tzvf", file], { encoding: "utf8" });

    expect(list).to.match(/agent\/agent$/m);
    expect(list).to.match(/agent\/compose\.yml$/m);
    expect(list).to.match(/^-rw------- .*agent\/\.env$/m);
    execFileSync("tar", ["-xzf", file, "-C", dir]);
    expect(readFileSync(join(dir, "agent", ".env"), "utf8")).to.equal("A=1\n");
  });

  it("тот же путь в архиве — ошибка", () => {
    expect(() =>
      appendToTarGz(packArchive(), "agent/compose.yml", "x", 0o644),
    ).to.throw("уже есть");
  });

  it(".env: адрес, токен, имя; http — с разрешением связи без шифрования", () => {
    expect(
      agentEnvText({
        server: "https://api.example.com",
        token: "ab.cd",
        name: "vps 1",
      }),
    ).to.equal(
      "# Агент: адрес бэкенда и токен регистрации (нужен только до первой регистрации).\n" +
        "AGENT_SERVER_URL=https://api.example.com\nAGENT_ENROLL_TOKEN=ab.cd\n" +
        'AGENT_NAME="vps 1"\n',
    );
    expect(
      agentEnvText({ server: "http://10.0.0.1:8181", token: "t" }),
    ).to.include("AGENT_SERVER_ALLOW_INSECURE=true");
    expect(isInsecureServer("HTTP://x")).to.equal(true);
    expect(isInsecureServer("https://x")).to.equal(false);
  });

  it("команда docker без имени — имя машины, а не контейнера", () => {
    expect(
      agentInstallCommand({
        mode: "docker",
        server: "https://api.example.com",
        token: "t",
      }),
    ).to.include(`'AGENT_ENROLL_TOKEN=t' "AGENT_NAME=$(hostname)" > .env`);
  });

  it("команда docker: архив агента, .env (0600), docker compose", () => {
    const command = agentInstallCommand({
      mode: "docker",
      server: "http://api.example.com/",
      token: "ab.cd",
      name: "vps-1",
    });

    expect(command).to.equal(
      "curl -fsSL 'http://api.example.com/agent/v1/bundle/agent.tar.gz' | tar -xz" +
        " && cd agent" +
        " && (umask 077 && printf '%s\\n' 'AGENT_SERVER_URL=http://api.example.com' 'AGENT_ENROLL_TOKEN=ab.cd' 'AGENT_SERVER_ALLOW_INSECURE=true' 'AGENT_NAME=vps-1' > .env)" +
        " && docker compose up -d --build",
    );
  });
});
