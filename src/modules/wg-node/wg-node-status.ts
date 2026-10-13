import type { AgentDto, IAgentHostDto, IAgentWorkerDto } from "../agent";
import type { IWgNodeAgentState, IWgNodeOsInfoPatch } from "./wg-node.service";
import { EWgMode, EWgNodeStatus, WG_NODE_WORKERS } from "./wg-node.types";

/** Длина версии агента в колонке. */
const AGENT_VERSION_MAX = 32;
/** Длина IP в колонке. */
const IP_MAX = 45;

/** Сведения воркера wg (событие `node.info`). */
export interface IWgWorkerInfo {
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
    return `Воркер ${name} не зарегистрирован: ${worker.message ?? "нет регистрации"}`;
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

/** Сведения узла от агента (ОС, архитектура, имя, ядро) — слияние в `osInfo`. */
export const hostOsInfoPatch = (host: IAgentHostDto): IWgNodeOsInfoPatch => ({
  set: {
    platform: host.os,
    arch: host.arch,
    hostname: host.hostname,
    ...(host.kernel && { kernel: host.kernel }),
  },
});

/**
 * Сведения узла от воркера wg (режим wg, дистрибутив, ядро, занятые порты) —
 * слияние в `osInfo`: сведения агента остаются; неверные значения
 * отбрасываются, режима нет — он убирается.
 */
export const workerOsInfoPatch = (info: IWgWorkerInfo): IWgNodeOsInfoPatch => {
  const mode = asMode(info.wgMode);

  return {
    set: {
      ...(asString(info.kernel) && { kernel: asString(info.kernel) }),
      ...(asString(info.distro) && { distro: asString(info.distro) }),
      ...(mode && { wgMode: mode }),
      ...(asPorts(info.udpPorts) && { udpPorts: asPorts(info.udpPorts) }),
      ...(asPorts(info.tcpPorts) && { tcpPorts: asPorts(info.tcpPorts) }),
    },
    ...(!mode && { remove: ["wgMode"] }),
  };
};

/**
 * Состояние ноды из записи агента: статус, версия агента, сведения узла
 * (слиянием: режим wg и порты присылает воркер wg событием `node.info`),
 * адрес и время связи.
 */
export const wgNodeStateOf = (agent: AgentDto): IWgNodeAgentState => ({
  ...wgNodeStatusOf(agent),
  agentVersion: agent.version?.slice(0, AGENT_VERSION_MAX) ?? null,
  ...(agent.host && { osInfoPatch: hostOsInfoPatch(agent.host) }),
  ...(agent.remoteIp && { agentRemoteIp: agent.remoteIp.slice(0, IP_MAX) }),
  ...(agent.lastSeenAt !== undefined && {
    lastSeenAt: new Date(agent.lastSeenAt),
  }),
});
