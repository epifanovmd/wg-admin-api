import { expect } from "chai";

import { agentAlerts, alertChanges, IAgentAlert } from "./agent-alerts";

const agent = (patch: Record<string, unknown> = {}): any => ({
  id: "a1",
  name: "node-1",
  labels: {},
  online: true,
  revoked: false,
  enrolledAt: 100,
  lastSeenAt: 500,
  statusAt: 400,
  workers: [],
  ...patch,
});

const status = (workers: object[]) => ({ workers });

describe("agentAlerts: проблемы агента", () => {
  it("без проблем — пусто", () => {
    expect(agentAlerts(agent(), [], 1_000)).to.deep.equal([]);
  });

  it("offline — агент без связи, с lastSeenAt", () => {
    expect(agentAlerts(agent({ online: false }), [], 1_000)).to.deep.equal([
      {
        key: "offline",
        agentId: "a1",
        agentName: "node-1",
        type: "offline",
        message: "агент без связи",
        since: 500,
      },
    ]);
  });

  it("воркеры: backoff и stopped, invalid, running с health.ok: false", () => {
    const alerts = agentAlerts(
      agent({
        status: status([
          { name: "wg", state: "backoff", restarts: 3 },
          { name: "socks", state: "stopped" },
          { name: "bad", state: "invalid", message: "нет GET /manifest" },
          { name: "odd", state: "invalid" },
          { name: "sick", state: "running", health: { ok: false } },
          { name: "fine", state: "running", health: { ok: true } },
        ]),
      }),
      [],
      1_000,
    );

    expect(alerts.map(a => [a.key, a.type, a.worker, a.message])).to.deep.equal(
      [
        [
          "workerDown:wg",
          "workerDown",
          "wg",
          "воркер wg не работает (backoff, перезапусков: 3)",
        ],
        [
          "workerDown:socks",
          "workerDown",
          "socks",
          "воркер socks не работает (stopped, перезапусков: 0)",
        ],
        [
          "workerInvalid:bad",
          "workerInvalid",
          "bad",
          "воркер bad не зарегистрирован: нет GET /manifest",
        ],
        [
          "workerInvalid:odd",
          "workerInvalid",
          "odd",
          "воркер odd не зарегистрирован: ответ GET /health или GET /manifest не подошёл",
        ],
        [
          "workerUnhealthy:sick",
          "workerUnhealthy",
          "sick",
          "воркер sick: плохое самочувствие",
        ],
      ],
    );
    expect(alerts.every(a => a.since === 400)).to.equal(true);
  });

  it("настройки в failed — configFailed с версией и ошибкой", () => {
    const alerts = agentAlerts(
      agent(),
      [
        {
          agentId: "a1",
          worker: "wg",
          key: "state",
          version: 3,
          delivered: 3,
          state: "failed",
          error: { code: "BAD", message: "нет интерфейса" },
          updatedAt: 450,
        },
        {
          agentId: "a1",
          worker: "wg",
          key: "probes",
          version: 2,
          state: "applied",
        },
      ],
      1_000,
    );

    expect(alerts).to.deep.equal([
      {
        key: "configFailed:wg/state",
        agentId: "a1",
        agentName: "node-1",
        type: "configFailed",
        worker: "wg",
        configKey: "state",
        message: "настройки wg/state версии 3 не применены: нет интерфейса",
        since: 450,
      },
    ]);
  });

  it("since прежней проблемы сохраняется", () => {
    const previous: IAgentAlert[] = [
      {
        key: "workerDown:wg",
        agentId: "a1",
        agentName: "node-1",
        type: "workerDown",
        worker: "wg",
        message: "",
        since: 50,
      },
    ];
    const [alert] = agentAlerts(
      agent({ status: status([{ name: "wg", state: "backoff" }]) }),
      [],
      1_000,
      previous,
    );

    expect(alert.since).to.equal(50);
  });

  it("alertChanges: закончившиеся — active: false, начавшиеся — active: true", () => {
    const of = (key: string): IAgentAlert => ({
      key,
      agentId: "a1",
      agentName: "node-1",
      type: "offline",
      message: key,
      since: 1,
    });

    expect(
      alertChanges(
        [of("offline"), of("workerDown:wg")],
        [of("workerDown:wg"), of("configFailed:wg/state")],
      ).map(change => [change.key, change.active]),
    ).to.deep.equal([
      ["offline", false],
      ["configFailed:wg/state", true],
    ]);
  });
});
