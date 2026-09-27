import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import { Injectable } from "../../core";
import { wgAgentConfig } from "./wg-agent.config";

/** Архитектуры, под которые собирается агент. */
export const WG_AGENT_ARCHES = ["amd64", "arm64"] as const;

export type TWgAgentArch = (typeof WG_AGENT_ARCHES)[number];

/** Собранный бинарь агента. */
export interface IWgAgentBinary {
  arch: TWgAgentArch;
  /** sha256 бинаря (hex) — с ним агент сверяет скачанное и свою версию. */
  hash: string;
  size: number;
  path: string;
}

/** Доступная версия агента: семантическая версия и бинари по архитектурам. */
export interface IWgAgentRelease {
  version: string | null;
  binaries: Partial<Record<TWgAgentArch, IWgAgentBinary>>;
}

/** Архитектура из отчёта агента (`runtime.GOARCH`) или null — не поддерживается. */
export const normalizeArch = (
  arch: string | null | undefined,
): TWgAgentArch | null => {
  switch (arch) {
    case "amd64":
    case "arm64":
      return arch;
    default:
      return null;
  }
};

const sha256File = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");

    createReadStream(file)
      .on("data", chunk => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

/**
 * Бинари агента из каталога релиза (`wg-admin-agent-linux-<arch>`, `VERSION`;
 * в образе бэкенда — `agent/dist`) — для установки и обновления агентов.
 * Читаются один раз: в образе неизменны.
 */
@Injectable()
export class WgAgentBinaryService {
  private _cached: Promise<IWgAgentRelease> | null = null;

  constructor(private readonly _dir: string = wgAgentConfig.distDir) {}

  release(): Promise<IWgAgentRelease> {
    this._cached ??= this._read();

    return this._cached;
  }

  /** Бинарь архитектуры или null (не собран). */
  async binary(arch: string): Promise<IWgAgentBinary | null> {
    const normalized = normalizeArch(arch);

    if (!normalized) return null;

    return (await this.release()).binaries[normalized] ?? null;
  }

  open(binary: IWgAgentBinary): Readable {
    return createReadStream(binary.path);
  }

  private async _read(): Promise<IWgAgentRelease> {
    const dir = this._dir;
    const binaries: IWgAgentRelease["binaries"] = {};

    for (const arch of WG_AGENT_ARCHES) {
      const file = path.join(dir, `wg-admin-agent-linux-${arch}`);
      const info = await stat(file).catch(() => null);

      if (info?.isFile()) {
        binaries[arch] = {
          arch,
          hash: await sha256File(file),
          size: info.size,
          path: file,
        };
      }
    }

    const version = (
      await readFile(path.join(dir, "VERSION"), "utf8").catch(() => "")
    ).trim();

    return { version: version || null, binaries };
  }
}
