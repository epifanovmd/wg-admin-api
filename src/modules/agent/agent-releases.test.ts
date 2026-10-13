import { expect } from "chai";

import { AGENT_RELEASES_GITHUB_DEFAULT } from "./agent.config";
import { agentReleasesOptions } from "./agent.runtime";

const base = {
  releasesUrl: undefined,
  releasesGithub: AGENT_RELEASES_GITHUB_DEFAULT,
  releasesRange: undefined,
  releasesToken: undefined,
  releasesProxy: false,
  releasesCheckIntervalMs: 3_600_000,
};

describe("источник сборок агента (agentReleases)", () => {
  it("по умолчанию — релизы GitHub epifanovmd/agent, версии — как мажорная версия agent-sdk", () => {
    expect(agentReleasesOptions(base)).to.deep.equal({
      github: "epifanovmd/agent",
      checkIntervalMs: 3_600_000,
      proxy: false,
    });
    expect(agentReleasesOptions({ ...base, releasesRange: "^2" })).to.include({
      range: "^2",
    });
  });

  it("токен GitHub и раздача через бэкенд", () => {
    expect(
      agentReleasesOptions({
        ...base,
        releasesToken: "ghp_example",
        releasesProxy: true,
        releasesCheckIntervalMs: 60_000,
      }),
    ).to.include({
      token: "ghp_example",
      proxy: true,
      checkIntervalMs: 60_000,
    });
  });

  it("адрес сборок (AGENT_RELEASES_URL) важнее GitHub", () => {
    const options = agentReleasesOptions({
      ...base,
      releasesUrl: "https://example.com/agent/v1.1.0",
    });

    expect(options).to.include({ url: "https://example.com/agent/v1.1.0" });
    expect(options).to.not.have.property("github");
  });

  it("ни GitHub, ни адреса сборок — агент только из каталога сборок", () => {
    expect(
      agentReleasesOptions({ ...base, releasesGithub: undefined }),
    ).to.equal(undefined);
  });
});
