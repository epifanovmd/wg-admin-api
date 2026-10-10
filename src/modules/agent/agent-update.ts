import type { Agent, UpdateCandidate } from "agent-sdk/server";

import type { IAgentUpdateCandidateDto } from "./dto";

const parse = (version: string) => {
  const [core, pre = ""] = version.replace(/^v/, "").split("-", 2);

  return { parts: core.split(".").map(n => Number(n) || 0), pre };
};

/** Сравнение версий semver: > 0 — `a` новее `b`; пре-релиз младше релиза той же версии. */
export const compareVersions = (a: string, b: string): number => {
  const x = parse(a);
  const y = parse(b);

  const diff = [0, 1, 2]
    .map(i => (x.parts[i] ?? 0) - (y.parts[i] ?? 0))
    .find(d => d !== 0);

  if (diff !== undefined) return diff;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;

  return x.pre < y.pre ? -1 : 1;
};

/**
 * Кого можно обновить: до версии с сервера (`server`) и до новой версии, которую агент нашёл
 * в своём каталоге сборок сам (`agent`, `hello`/`status` → `update.latest`) — даже если
 * сервер её ещё не видел. Из двух целей берётся новейшая.
 */
export const mergeUpdateCandidates = (
  server: UpdateCandidate[],
  agents: Agent[],
): IAgentUpdateCandidateDto[] => {
  const result = new Map<string, IAgentUpdateCandidateDto>(
    server.map(c => [c.agentId, { ...c, source: "server" }]),
  );

  for (const agent of agents) {
    const latest = agent.update?.latest;

    if (agent.revoked || !latest || !agent.version || !agent.host) continue;
    if (compareVersions(latest, agent.version) <= 0) continue;
    const known = result.get(agent.id);

    if (known && compareVersions(latest, known.target) <= 0) continue;
    result.set(agent.id, {
      agentId: agent.id,
      name: agent.name,
      online: agent.online,
      current: agent.version,
      target: latest,
      os: agent.host.os,
      arch: agent.host.arch,
      source: "agent",
    });
  }

  return [...result.values()];
};
