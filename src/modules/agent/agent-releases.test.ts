import { expect } from "chai";

import {
  AGENT_RELEASES_GITHUB_DEFAULT,
  AGENT_RELEASES_PUBLIC_KEY_DEFAULT,
  AGENT_RELEASES_RANGE_DEFAULT,
} from "./agent.config";
import { agentReleasesOptions } from "./agent.runtime";

const base = {
  releasesUrl: undefined,
  releasesGithub: AGENT_RELEASES_GITHUB_DEFAULT,
  releasesRange: AGENT_RELEASES_RANGE_DEFAULT,
  releasesToken: undefined,
  releasesProxy: false,
  releasesCheckIntervalMs: 3_600_000,
  releasesPublicKey: AGENT_RELEASES_PUBLIC_KEY_DEFAULT,
};

describe("источник сборок агента (agentReleases)", () => {
  it("по умолчанию — релизы GitHub epifanovmd/agent в диапазоне ^1 с ключом автора", () => {
    expect(agentReleasesOptions(base)).to.deep.equal({
      github: "epifanovmd/agent",
      range: "^1",
      checkIntervalMs: 3_600_000,
      proxy: false,
      publicKey: AGENT_RELEASES_PUBLIC_KEY_DEFAULT,
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

  it("пустой ключ автора — ключ берётся из manifest.json источника", () => {
    expect(
      agentReleasesOptions({ ...base, releasesPublicKey: undefined }),
    ).to.not.have.property("publicKey");
  });
});
