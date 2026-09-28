import { expect } from "chai";

import { AppInfoService } from "./app-info.service";

const agent = (version: string | null) => ({
  release: async () => ({ version, binaries: {} }),
});

describe("AppInfoService", () => {
  it("версия, коммит и время сборки — из конфига, запуск — время старта процесса, агент — из релиза", async () => {
    const service = new AppInfoService(agent("2.2.2"), {
      name: "wg-admin",
      role: "all",
      publicUrl: "http://localhost",
      version: "v1.2.0-3-gabc1234",
      commit: "abc1234",
      builtAt: "2026-09-28T20:00:00Z",
    });
    const info = await service.version();
    const started = new Date(info.startedAt).getTime();

    expect(info).to.include({
      version: "v1.2.0-3-gabc1234",
      commit: "abc1234",
      builtAt: "2026-09-28T20:00:00Z",
      agentVersion: "2.2.2",
    });
    expect(started).to.be.at.most(Date.now());
    expect(started).to.be.at.least(Date.now() - process.uptime() * 1000 - 1000);
  });

  it("вне сборки образа — коммит и время сборки null; агент не собран — null", async () => {
    const info = await new AppInfoService(agent(null), {
      name: "wg-admin",
      role: "all",
      publicUrl: "http://localhost",
      version: "1.0.1",
      commit: null,
      builtAt: null,
    }).version();

    expect(info.commit).to.equal(null);
    expect(info.builtAt).to.equal(null);
    expect(info.agentVersion).to.equal(null);
  });
});
