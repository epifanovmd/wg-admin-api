import { expect } from "chai";

import { AppInfoService } from "./app-info.service";

const agent = (version: string | null) => ({
  releaseVersion: async () => version,
});

describe("AppInfoService", () => {
  it("версия, коммит и время сборки — из конфига, запуск — время старта процесса, агент — из выпуска", async () => {
    const service = new AppInfoService(agent("1.0.0"), {
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
      agentVersion: "1.0.0",
    });
    expect(started).to.be.at.most(Date.now());
    expect(started).to.be.at.least(Date.now() - process.uptime() * 1000 - 1000);
  });

  it("вне сборки образа — коммит и время сборки null; выпуска нет — null", async () => {
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
