import type { AgentDto, IAgentWorkerDto } from "../agent";
import type { IWgNodeAgentState } from "./wg-node.service";
import {
  EWgMode,
  EWgNodeStatus,
  IWgNodeOsInfo,
  WG_NODE_WORKERS,
  WG_WORKER,
} from "./wg-node.types";

/** Длина версии wg в колонке. */
const WG_VERSION_MAX = 64;
/** Длина версии агента в колонке. */
const AGENT_VERSION_MAX = 32;
/** Длина IP в колонке. */
const IP_MAX = 45;

/** Сведения воркера wg из `GET /health` (`info`). */
interface IWgWorkerInfo {
  wgVersion?: unknown;
  wgMode?: unknown;
  distro?: unknown;
  kernel?: unknown;
  udpPorts?: unknown;
  tcpPorts?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const asPorts = (value: unknown): number[] | undefined =>
  Array.isArray(value)
    ? value.filter((port): port is number => Number.isInteger(port))
    : undefined;

const asMode = (value: unknown): EWgMode | undefined =>
  value === EWgMode.Kernel || value === EWgMode.Userspace ? value : undefined;

/**
 * Беда воркера ноды: не зарегистрирован, не работает, не в порядке. `null`
 * — всё хорошо. Нет воркера в настройках агента — тоже беда: ноде он нужен.
 */
export const workerProblem = (agent: AgentDto, name: string): string | null => {
  const worker: IAgentWorkerDto | undefined = agent.workers.find(
    item => item.name === name,
  );

  if (!worker) return `Нет воркера ${name} в настройках агента`;
  if (worker.state === "invalid") {
    return `Воркер ${name} не зарегистрирован: ${worker.message ?? "нет ответа на /health или /manifest"}`;
  }
  if (worker.state === "backoff" || worker.state === "stopped") {
    return `Воркер ${name} не работает`;
  }
  if (worker.state === "starting") return `Воркер ${name} запускается`;
  if (worker.health && !worker.health.ok) {
    return `Воркер ${name}: ${worker.health.message ?? "не в порядке"}`;
  }

  return null;
};

/**
 * Статус ноды по её агенту: отозван — `created` (ждёт новой установки), без
 * связи — `offline`, беда воркеров wg или socks — `error`, иначе `online`.
 */
export const wgNodeStatusOf = (
  agent: AgentDto,
): { status: EWgNodeStatus; statusMessage: string | null } => {
  if (agent.revoked) {
    return { status: EWgNodeStatus.Created, statusMessage: "Агент отозван" };
  }
  if (!agent.online) {
    return { status: EWgNodeStatus.Offline, statusMessage: null };
  }

  for (const name of WG_NODE_WORKERS) {
    const problem = workerProblem(agent, name);

    if (problem) return { status: EWgNodeStatus.Error, statusMessage: problem };
  }

  return { status: EWgNodeStatus.Online, statusMessage: null };
};

/**
 * Состояние ноды из записи агента: статус, версии, ОС (узел — от агента,
 * режим wg и занятые порты — от воркера wg), адрес и время связи.
 */
export const wgNodeStateOf = (agent: AgentDto): IWgNodeAgentState => {
  const wg = agent.workers.find(worker => worker.name === WG_WORKER);
  const info = (wg?.health?.info ?? {}) as IWgWorkerInfo;
  const osInfo: IWgNodeOsInfo = {
    ...(agent.host && {
      platform: agent.host.os,
      arch: agent.host.arch,
      hostname: agent.host.hostname,
      ...(agent.host.kernel && { kernel: agent.host.kernel }),
    }),
    ...(asString(info.kernel) && { kernel: asString(info.kernel) }),
    ...(asString(info.distro) && { distro: asString(info.distro) }),
    ...(asMode(info.wgMode) && { wgMode: asMode(info.wgMode) }),
    ...(asPorts(info.udpPorts) && { udpPorts: asPorts(info.udpPorts) }),
    ...(asPorts(info.tcpPorts) && { tcpPorts: asPorts(info.tcpPorts) }),
  };

  return {
    ...wgNodeStatusOf(agent),
    agentVersion: agent.version?.slice(0, AGENT_VERSION_MAX) ?? null,
    ...(wg?.health && {
      wgVersion: asString(info.wgVersion)?.slice(0, WG_VERSION_MAX) ?? null,
    }),
    // Без ответа воркера (перезапуск) прежние порты и режим остаются.
    ...(agent.host && wg?.health && { osInfo }),
    ...(agent.address && { agentRemoteIp: agent.address.slice(0, IP_MAX) }),
    ...(agent.lastSeenAt !== undefined && {
      lastSeenAt: new Date(agent.lastSeenAt),
    }),
  };
};
