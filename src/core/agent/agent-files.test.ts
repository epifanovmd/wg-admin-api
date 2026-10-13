import { expect } from "chai";

import {
  agentInstallCommand,
  bundleArchiveUrl,
  bundleInstallFlags,
  bundleInstallUrl,
} from "./agent-files";

describe("agent-files", () => {
  const server = "https://api.example.com/";

  it("адреса установщика и архива — от адреса сервера без завершающего /", () => {
    expect(bundleInstallUrl(server)).to.equal(
      "https://api.example.com/agent/v1/bundle/install.sh",
    );
    expect(bundleArchiveUrl(server)).to.equal(
      "https://api.example.com/agent/v1/bundle/linux-{arch}.tar.gz",
    );
    expect(bundleInstallFlags(server)).to.deep.equal([
      "--server",
      "https://api.example.com",
      "--bundle",
      "https://api.example.com/agent/v1/bundle/linux-{arch}.tar.gz",
    ]);
  });

  it("команда установки: служба — с sudo, rootless и run — без; имя без кавычек внутри", () => {
    expect(agentInstallCommand({ server, token: "t.s" })).to.equal(
      "curl -fsSL 'https://api.example.com/agent/v1/bundle/install.sh' | sudo sh -s -- " +
        "--server 'https://api.example.com' --bundle 'https://api.example.com/agent/v1/bundle/linux-{arch}.tar.gz' --token 't.s'",
    );
    expect(
      agentInstallCommand({ server, token: "t.s", mode: "rootless" }),
    ).to.match(/\| sh -s -- .* --rootless$/);
    expect(
      agentInstallCommand({
        server,
        tokenFile: "/tmp/t",
        mode: "run",
        name: "a'b",
      }),
    ).to.match(/\| sh -s -- .*--token-file '\/tmp\/t' --name 'a'\\''b' --run$/);
  });
});
