import { readdir, stat } from "fs/promises";
import { join } from "path";

import { config } from "../../config";
import { agentConfig, Injectable } from "../../core";
import { IAppVersionDto } from "./app-info.dto";

/** Архив папки агента (`agent pack`): `agent-<имя>-<версия агента>-<os>-<arch>.tar.gz`. */
const BUNDLE_ARCHIVE =
  /^agent-[a-z0-9-]+?-(\d+\.\d+\.\d+[^-]*)-(?:linux|darwin)-(?:amd64|arm64)\.tar\.gz$/;

/**
 * Версия агента в архивах каталога `dir` (новейший архив); архивов нет —
 * `null`.
 */
export const bundleAgentVersion = async (
  dir: string | undefined,
): Promise<string | null> => {
  if (!dir) return null;

  let best: { version: string; mtime: number } | null = null;

  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const version = BUNDLE_ARCHIVE.exec(name)?.[1];
    const info = version ? await stat(join(dir, name)).catch(() => null) : null;

    if (version && info && (!best || info.mtimeMs > best.mtime)) {
      best = { version, mtime: info.mtimeMs };
    }
  }

  return best?.version ?? null;
};

/** Сведения о запущенном бэкенде. */
@Injectable()
export class AppInfoService {
  private readonly _startedAt = new Date(
    Date.now() - process.uptime() * 1000,
  ).toISOString();

  constructor(
    private readonly _app: typeof config.app = config.app,
    private readonly _agentVersion: () => Promise<string | null> = () =>
      bundleAgentVersion(agentConfig.bundleDir),
  ) {}

  async version(): Promise<IAppVersionDto> {
    return {
      version: this._app.version,
      commit: this._app.commit,
      builtAt: this._app.builtAt,
      startedAt: this._startedAt,
      agentVersion: await this._agentVersion(),
    };
  }
}
