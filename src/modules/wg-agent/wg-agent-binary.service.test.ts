import "reflect-metadata";

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";

import { normalizeArch, WgAgentBinaryService } from "./wg-agent-binary.service";

describe("WgAgentBinaryService", () => {
  it("бинари по архитектурам с sha256 и версией; без сборки — пусто", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wg-agent-bin-"));

    expect(await new WgAgentBinaryService(root).release()).to.deep.equal({
      version: null,
      binaries: {},
    });

    await writeFile(path.join(root, "wg-admin-agent-linux-amd64"), "AMD");
    await writeFile(path.join(root, "VERSION"), "2.0.0\n");

    const service = new WgAgentBinaryService(root);
    const release = await service.release();

    expect(release.version).to.equal("2.0.0");
    // sha256("AMD") — тот же, что считает агент по своему бинарю.
    expect(release.binaries.amd64?.hash).to.equal(
      "0fd3e4e71b62f7775696d50033366d824247be4337d7f35f9026c00d920e423f",
    );
    expect(release.binaries.amd64?.size).to.equal(3);
    expect(release.binaries.arm64).to.equal(undefined);
    expect(await service.binary("amd64")).to.deep.equal(release.binaries.amd64);
    expect(await service.binary("arm64")).to.equal(null);
    expect(await service.binary("mips")).to.equal(null);
  });

  it("архитектура из отчёта агента: только amd64 и arm64", () => {
    expect(normalizeArch("amd64")).to.equal("amd64");
    expect(normalizeArch("arm64")).to.equal("arm64");
    expect(normalizeArch("x86_64")).to.equal(null);
    expect(normalizeArch("riscv64")).to.equal(null);
    expect(normalizeArch(null)).to.equal(null);
  });
});
