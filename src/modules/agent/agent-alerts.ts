import type { Agent, ConfigStatus } from "agent-sdk/server";

/** Вид проблемы агента. */
export type TAgentAlertType =
  | "offline"
  | "workerDown"
  | "workerInvalid"
  | "workerUnhealthy"
  | "configFailed";

/** Проблема агента: выводится из его записи и статусов настроек. */
export interface IAgentAlert {
  /** Ключ в пределах агента: `offline`, `workerDown:<воркер>`, `workerInvalid:<воркер>`, `workerUnhealthy:<воркер>`, `configFailed:<воркер>/<ключ>`. */
  key: string;
  agentId: string;
  agentName: string;
  type: TAgentAlertType;
  worker?: string;
  configKey?: string;
  message: string;
  /** С какого времени, мс. */
  since: number;
}

/** Проблема началась (`active: true`) или закончилась. */
export interface IAgentAlertChange extends IAgentAlert {
  active: boolean;
}

/**
 * Проблемы агента: `offline` — агент без связи (с `lastSeenAt`); воркер в
 * `backoff` или `stopped`, `invalid`, с `health.ok: false`; ключ настроек в
 * `failed`. `since` проблемы, которая уже была (`previous`, тот же ключ),
 * сохраняется; новая — со времени последнего `status` (настройки — со времени
 * статуса ключа), иначе `now`.
 */
export const agentAlerts = (
  agent: Agent,
  configs: readonly ConfigStatus[],
  now: number,
  previous: readonly IAgentAlert[] = [],
): IAgentAlert[] => {
  const base = { agentId: agent.id, agentName: agent.name };
  const known = new Map(previous.map(alert => [alert.key, alert.since]));
  const out: IAgentAlert[] = [];
  const add = (alert: Omit<IAgentAlert, "since">, since: number) =>
    out.push({ ...alert, since: known.get(alert.key) ?? since });

  if (!agent.online) {
    out.push({
      ...base,
      key: "offline",
      type: "offline",
      message: "агент без связи",
      since: agent.lastSeenAt ?? agent.enrolledAt,
    });
  }

  const statusAt = agent.statusAt ?? now;

  for (const worker of agent.status?.workers ?? []) {
    if (worker.state === "backoff" || worker.state === "stopped") {
      add(
        {
          ...base,
          key: `workerDown:${worker.name}`,
          type: "workerDown",
          worker: worker.name,
          message: `воркер ${worker.name} не работает (${worker.state}, перезапусков: ${worker.restarts ?? 0})`,
        },
        statusAt,
      );
    } else if (worker.state === "invalid") {
      add(
        {
          ...base,
          key: `workerInvalid:${worker.name}`,
          type: "workerInvalid",
          worker: worker.name,
          message: `воркер ${worker.name} не зарегистрирован: ${worker.message || "ответ GET /health или GET /manifest не подошёл"}`,
        },
        statusAt,
      );
    } else if (worker.state === "running" && worker.health?.ok === false) {
      add(
        {
          ...base,
          key: `workerUnhealthy:${worker.name}`,
          type: "workerUnhealthy",
          worker: worker.name,
          message: `воркер ${worker.name}: ${worker.health.message || "плохое самочувствие"}`,
        },
        statusAt,
      );
    }
  }

  for (const status of configs) {
    if (status.state !== "failed") continue;
    add(
      {
        ...base,
        key: `configFailed:${status.worker}/${status.key}`,
        type: "configFailed",
        worker: status.worker,
        configKey: status.key,
        message: `настройки ${status.worker}/${status.key} версии ${status.delivered ?? status.version} не применены: ${status.error?.message ?? status.error?.code ?? ""}`,
      },
      status.updatedAt ?? now,
    );
  }

  return out;
};

/** Что изменилось между прежними и новыми проблемами агента. */
export const alertChanges = (
  previous: readonly IAgentAlert[],
  next: readonly IAgentAlert[],
): IAgentAlertChange[] => {
  const before = new Set(previous.map(alert => alert.key));
  const after = new Set(next.map(alert => alert.key));

  return [
    ...previous
      .filter(alert => !after.has(alert.key))
      .map(alert => ({ ...alert, active: false })),
    ...next
      .filter(alert => !before.has(alert.key))
      .map(alert => ({ ...alert, active: true })),
  ];
};
