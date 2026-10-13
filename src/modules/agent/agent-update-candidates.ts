import type { Agent, ReleaseView, WorkerArtifact } from "agent-sdk/server";

/** Агент, которого можно обновить до новой версии. */
export interface IAgentUpdateCandidate {
  agentId: string;
  agentName: string;
  online: boolean;
  current: string;
  target: string;
  os: string;
  arch: string;
}

/** Воркер со сборкой с сервера, которого можно обновить. */
export interface IWorkerUpdateCandidate extends IAgentUpdateCandidate {
  worker: string;
}

/** Кого можно обновить: агенты и воркеры. */
export interface IUpdateCandidates {
  agents: IAgentUpdateCandidate[];
  workers: IWorkerUpdateCandidate[];
}

interface ISemver {
  core: number[];
  pre: string[];
}

/** Версия вида `1.2.3[-pre][+build]` (с `v` и без; `1.2` — `1.2.0`); не версия — `null`. */
const semverOf = (version: string): ISemver | null => {
  const match =
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(
      version.trim(),
    );

  if (!match) return null;

  return {
    core: [match[1], match[2], match[3]].map(part => Number(part ?? 0)),
    pre: match[4] ? match[4].split(".") : [],
  };
};

const comparePre = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;

    const [x, y] = [Number(a[i]), Number(b[i])];
    const numeric = [/^\d+$/.test(a[i]), /^\d+$/.test(b[i])];

    if (numeric[0] && numeric[1]) return x - y;
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1;

    return a[i] < b[i] ? -1 : 1;
  }

  return 0;
};

const compare = (a: ISemver, b: ISemver): number => {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }

  return comparePre(a.pre, b.pre);
};

/** `a` новее `b` (`2.0.0` новее `2.0.0-rc.1`); версия новее не версии, не версии между собой не новее. */
export const newerVersion = (a: string, b: string): boolean => {
  const x = semverOf(a);
  const y = semverOf(b);

  return x !== null && (y === null || compare(x, y) > 0);
};

/** Та же версия (`v1.2.0` и `1.2.0`); не версии — по строке. */
export const sameVersion = (a: string, b: string): boolean => {
  const x = semverOf(a);
  const y = semverOf(b);

  return x !== null && y !== null ? compare(x, y) === 0 : a === b;
};

/** Обновляет ли агент себя по команде сервера: режим `self` или режим не сообщён. */
export const selfUpdating = (agent: Agent): boolean => {
  const mode = agent.hello?.agent.updateMode;

  return !mode || mode === "self";
};

/** Новейшая сборка воркера под платформу. */
const workerArtifact = (
  release: ReleaseView,
  name: string,
  os: string,
  arch: string,
): WorkerArtifact | undefined => {
  let best: WorkerArtifact | undefined;

  for (const artifact of release.workers ?? []) {
    if (artifact.name !== name || artifact.os !== os || artifact.arch !== arch)
      continue;
    if (!best || newerVersion(artifact.version, best.version)) best = artifact;
  }

  return best;
};

/**
 * Кого можно обновить. Агент — до новой версии, которую он нашёл в своём
 * каталоге сборок (`update.latest`), если он обновляет себя сам; отозванные и
 * не приславшие `hello` не входят. Воркер со сборкой с сервера
 * (`release: true`) — до новейшей сборки под платформу агента в сборках
 * проекта (`release`), если её версия другая.
 */
export const updateCandidates = (
  agents: readonly Agent[],
  release: ReleaseView | null,
): IUpdateCandidates => {
  const out: IUpdateCandidates = { agents: [], workers: [] };

  for (const agent of agents) {
    const hello = agent.hello;

    if (agent.revoked || !hello) continue;

    const { os, arch } = hello.host;
    const base = {
      agentId: agent.id,
      agentName: agent.name,
      online: agent.online,
      os,
      arch,
    };
    const current = hello.agent.version;
    const latest = agent.update?.latest;

    if (selfUpdating(agent) && latest && newerVersion(latest, current)) {
      out.agents.push({ ...base, current, target: latest });
    }
    if (!release?.workers?.length) continue;
    for (const worker of agent.workers) {
      const artifact =
        worker.release && workerArtifact(release, worker.name, os, arch);

      if (!artifact || sameVersion(worker.version ?? "", artifact.version))
        continue;
      out.workers.push({
        ...base,
        worker: worker.name,
        current: worker.version ?? "",
        target: artifact.version,
      });
    }
  }

  return out;
};
