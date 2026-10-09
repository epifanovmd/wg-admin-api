import { Actor, call, eventually, expectStatus, items } from "./client";
import { FakeNodeAgent, IFakeAgentOptions } from "./fake-agent";

/** Помощники сценариев домена с фейковым агентом ноды. */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Админ сценариев: им читается версия конфигурации ноды. */
let stateReader: Actor;

export const useStateReader = (actor: Actor): void => {
  stateReader = actor;
};

/** Агент ноды по ответу создания: регистрация по токену из команды установки. */
export const attachAgent = (
  created: any,
  name?: string,
  options: Omit<IFakeAgentOptions, "name"> = {},
) => FakeNodeAgent.start(created.install.token, { name, ...options });

/** Нода агента — по списку нод. */
export const nodeOf = async (agent: FakeNodeAgent): Promise<string> =>
  eventually(async () => {
    const res = await call(stateReader, "GET", "/api/v1/wg/nodes?limit=100");

    return (
      items(res.data).find((n: any) => n.agentId === agent.agentId)?.id ?? null
    );
  });

/**
 * Настройки воркеров ноды, как их получил агент, — когда дошла текущая
 * версия конфигурации ноды: `state` воркера wg, его `probes` и прокси
 * воркера socks.
 */
export const agentState = async (agent: FakeNodeAgent) => {
  const nodeId = agent.config("wg", "state")?.nodeId ?? (await nodeOf(agent));
  const version = async (): Promise<number> =>
    expectStatus(
      await call(stateReader, "GET", `/api/v1/wg/nodes/${nodeId}`),
      200,
    ).data.configVersion;
  // Реакции на изменение (слушатели после транзакции) могут поднять версию
  // ещё раз — ждём, пока она не перестанет расти.
  let target = await version();

  for (;;) {
    const wanted = target;

    await agent.waitConfig("wg", "state", data => data.version >= wanted);
    await sleep(300);
    target = await version();
    if (target === wanted && agent.config("wg", "state").version === wanted) {
      break;
    }
  }

  return {
    ...agent.config("wg", "state"),
    probeTargets: agent.config("wg", "probes")?.targets ?? [],
    socks: agent.config("socks", "proxies")?.proxies ?? [],
  };
};

/**
 * Итог применения от воркера wg (событие `state.result`) и сведения о нём
 * (`status`: версия wg, режим, порты).
 */
export const report = async (agent: FakeNodeAgent, body: any) => {
  if (body.wgVersion !== undefined || body.os) {
    agent.status({
      wg: {
        health: {
          ok: true,
          info: {
            wgVersion: body.wgVersion,
            ...(body.os ?? {}),
          },
        },
      },
    });
  }
  if (body.interfaces) {
    // Как настоящий воркер: следующие версии — с теми же статусами.
    const interfaces = body.interfaces;

    agent.stateResult = state => ({
      version: state.version,
      appliedAt: Date.now(),
      interfaces,
      routes: [],
      errors: [],
    });
  }
  if (body.interfaces || body.appliedVersion !== undefined) {
    await agent.event("wg", "state.result", {
      version: body.appliedVersion ?? agent.config("wg", "state")?.version ?? 0,
      appliedAt: Date.now(),
      interfaces: body.interfaces ?? [],
      routes: [],
      errors: body.applyError ? [body.applyError] : [],
    });
  }
  await sleep(300);
};

/** Точка метрик: воркер wg, воркер socks, узел (`sysmetrics`). */
export const stats = async (agent: FakeNodeAgent, body: any) => {
  const sys = body.sys;

  agent.metrics({
    wg: {
      interfaces: body.interfaces ?? [],
      ...(body.tunnels && { tunnels: body.tunnels }),
      ...(body.forwards && { forwards: body.forwards }),
      ...(body.nodeProbes && { nodeProbes: body.nodeProbes }),
    },
    ...(body.socks && { socks: { proxies: body.socks } }),
    ...(sys && {
      host: {
        ...sys,
        interfaces: sys.nics,
        conntrack: sys.conntrackCount,
      },
    }),
  });
  await sleep(300);
};
