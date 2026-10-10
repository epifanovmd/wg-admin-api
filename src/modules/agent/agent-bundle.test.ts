import { expect } from "chai";
import { mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  bundleFile,
  bundleInstallUrl,
  installCommand,
  installScript,
} from "./agent-bundle";

describe("agent-bundle", () => {
  it("команда установки: скрипт с этого сервера, токен значением или файлом", () => {
    expect(bundleInstallUrl("https://api.example.com/")).to.equal(
      "https://api.example.com/api/v1/agent-bundle/install.sh",
    );
    expect(
      installCommand("https://api.example.com", { token: "a'b" }),
    ).to.equal(
      `curl -fsSL 'https://api.example.com/api/v1/agent-bundle/install.sh' | sudo sh -s -- --token 'a'\\''b'`,
    );
    expect(
      installCommand("https://x", { tokenFile: "/run/t", name: "msk 1" }),
    ).to.include("--token-file '/run/t' --name 'msk 1'");
  });

  it("скрипт: архив под процессор узла, agent install с адресом сервера, --uninstall", () => {
    const script = installScript("https://api.example.com/");

    expect(script).to.include("SERVER='https://api.example.com'");
    expect(script).to.include(
      'URL="$SERVER/api/v1/agent-bundle/linux-$ARCH.tar.gz"',
    );
    expect(script).to.include(
      '"$TMP/agent/agent" install --server "$SERVER" "$@"',
    );
    expect(script).to.include('"$TMP/agent/agent" uninstall "$@"');
  });

  it("архив под платформу: по процессору, новейший", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    const old = join(dir, "agent-prod-1.1.0-linux-amd64.tar.gz");
    const fresh = join(dir, "agent-prod-1.2.0-linux-amd64.tar.gz");

    for (const f of [
      old,
      fresh,
      join(dir, "agent-prod-1.2.0-linux-arm64.tar.gz"),
      join(dir, "notes.txt"),
    ]) {
      writeFileSync(f, "x");
    }
    utimesSync(old, new Date(1000), new Date(1000));
    expect(bundleFile(dir, "linux", "amd64")).to.equal(fresh);
    expect(bundleFile(dir, "linux", "arm64")).to.match(/linux-arm64\.tar\.gz$/);
    expect(bundleFile(dir, "darwin", "arm64")).to.equal(undefined);
    expect(bundleFile(join(dir, "none"), "linux", "amd64")).to.equal(undefined);
  });
});
