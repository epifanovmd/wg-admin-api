import { expect } from "chai";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { AppInfoService, bundleAgentVersion } from "./app-info.service";

const agent = (version: string | null) => async () => version;

describe("AppInfoService", () => {
  it("версия, коммит и время сборки — из конфига, запуск — время старта процесса, агент — из сборок", async () => {
    const service = new AppInfoService(
      {
        name: "wg-admin",
        role: "all",
        publicUrl: "http://localhost",
        version: "v1.2.0-3-gabc1234",
        commit: "abc1234",
        builtAt: "2026-09-28T20:00:00Z",
      },
      agent("1.0.0"),
    );
    const info = await service.version();
    const started = new Date(info.startedAt).getTime();

    expect(info).to.include({
      version: "v1.2.0-3-gabc1234",
      commit: "abc1234",
      builtAt: "2026-09-28T20:00:00Z",
      agentVersion: "1.0.0",
    });
    expect(started).to.be.at.most(Date.now());
    expect(started).to.be.at.least(Date.now() - process.uptime() * 1000 - 1000);
  });

  it("вне сборки образа — коммит и время сборки null; сборок агента нет — null", async () => {
    const info = await new AppInfoService(
      {
        name: "wg-admin",
        role: "all",
        publicUrl: "http://localhost",
        version: "1.0.1",
        commit: null,
        builtAt: null,
      },
      agent(null),
    ).version();

    expect(info.commit).to.equal(null);
    expect(info.builtAt).to.equal(null);
    expect(info.agentVersion).to.equal(null);
  });

  it("версия агента — из имени новейшего архива папки агента; каталога или архивов нет — null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bundle-"));

    try {
      expect(await bundleAgentVersion(undefined)).to.equal(null);
      expect(await bundleAgentVersion(dir)).to.equal(null);
      await writeFile(join(dir, "agent-wg-0.9.0-linux-amd64.tar.gz"), "");
      await new Promise(r => setTimeout(r, 20));
      await writeFile(join(dir, "agent-wg-1.0.0-linux-arm64.tar.gz"), "");
      await writeFile(join(dir, "install.sh"), "");
      expect(await bundleAgentVersion(dir)).to.equal("1.0.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
