import { expect } from "chai";
import { mkdtempSync, utimesSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";

import {
  bundleArchiveUrl,
  bundleInstallFlags,
  bundleInstallUrl,
  serveBundle,
} from "./agent-bundle";

describe("agent-bundle", () => {
  let server: Server;
  let base: string;
  let dir: string;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "agent-bundle-"));
    writeFileSync(join(dir, "install.sh"), "#!/bin/sh\n");
    writeFileSync(join(dir, "agent-prod-1.0.0-linux-amd64.tar.gz"), "old");
    writeFileSync(join(dir, "agent-prod-1.1.0-linux-amd64.tar.gz"), "new");
    utimesSync(join(dir, "agent-prod-1.0.0-linux-amd64.tar.gz"), 1, 1);
    server = createServer((req, res) => {
      void serveBundle(dir, req, res, (req.url ?? "/").split("?")[0]).then(
        handled => {
          if (!handled) res.writeHead(418).end();
        },
      );
    });
    await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => server.close());

  it("адреса и флаги установщика: архив под машину — {arch}", () => {
    expect(bundleInstallUrl("https://api.example.com/")).to.equal(
      "https://api.example.com/api/v1/agent-link/bundle/install.sh",
    );
    expect(bundleArchiveUrl("https://api.example.com")).to.equal(
      "https://api.example.com/api/v1/agent-link/bundle/linux-{arch}.tar.gz",
    );
    expect(bundleInstallFlags("https://api.example.com/")).to.deep.equal([
      "--server",
      "https://api.example.com",
      "--bundle",
      "https://api.example.com/api/v1/agent-link/bundle/linux-{arch}.tar.gz",
    ]);
  });

  it("install.sh и новейший архив под платформу; нет архива — 404, чужой путь — не наш", async () => {
    const script = await fetch(bundleInstallUrl(base));

    expect(script.status).to.equal(200);
    expect(await script.text()).to.equal("#!/bin/sh\n");
    expect(
      await (
        await fetch(`${base}/api/v1/agent-link/bundle/linux-amd64.tar.gz`)
      ).text(),
    ).to.equal("new");
    expect(
      (await fetch(`${base}/api/v1/agent-link/bundle/linux-arm64.tar.gz`))
        .status,
    ).to.equal(404);
    expect(
      (await fetch(`${base}/api/v1/agent-link/bundle/secret.txt`)).status,
    ).to.equal(404);
    expect((await fetch(`${base}/api/v1/agent-link/enroll`)).status).to.equal(
      418,
    );
  });
});
