import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  applyErrorOf,
  sysMetricsOf,
  WgAgentTelemetryService,
} from "./wg-agent-telemetry.service";

describe("WgAgentTelemetryService", () => {
  const make = (node: Record<string, unknown> | null) => {
    const nodes = {
      findByAgentId: sinon.stub().resolves(node),
      applyAgentState: sinon.stub().resolves(),
    };
    const interfaces = { updateReportedStatuses: sinon.stub().resolves() };
    const replicas = { recordServingNodes: sinon.stub().resolves() };
    const ingest = { ingest: sinon.stub().resolves({ backfill: false }) };
    const links = { recordProbes: sinon.stub().resolves() };
    const mesh = { recordProbes: sinon.stub().resolves() };
    const forwards = { recordRoutes: sinon.stub().resolves() };
    const socks = { recordStats: sinon.stub().resolves() };
    const seen = new Map<string, number>();
    const live = {
      incrBy: sinon.stub().callsFake(async (key: string, delta: number) => {
        seen.set(key, (seen.get(key) ?? 0) + delta);

        return seen.get(key);
      }),
    };
    const service = new WgAgentTelemetryService(
      nodes as any,
      interfaces as any,
      replicas as any,
      ingest as any,
      links as any,
      mesh as any,
      forwards as any,
      socks as any,
      live as any,
    );

    return { service, nodes, interfaces, ingest, links, mesh, forwards, socks };
  };

  it("метрики узла: группы sysmetrics → метрики ноды", () => {
    expect(
      sysMetricsOf({
        cpuPercent: 10,
        load1: 0.5,
        memUsedBytes: 1,
        memTotalBytes: 2,
        interfaces: [{ name: "eth0", rxBps: 3, txBps: 4 }],
        conntrack: 7,
      }),
    ).to.deep.include({
      cpuPercent: 10,
      load1: 0.5,
      conntrackCount: 7,
      conntrackMax: null,
      nics: [{ name: "eth0", rxBps: 3, txBps: 4 }],
    });
    expect(sysMetricsOf(undefined)).to.equal(undefined);
  });

  it("ошибка применения — ошибки частей через «; »; нет — null", () => {
    expect(
      applyErrorOf({ version: 1, interfaces: [], errors: ["a", "b"] }),
    ).to.equal("a; b");
    expect(applyErrorOf({ version: 1, interfaces: [], errors: [] })).to.equal(
      null,
    );
  });

  it("точка метрик: пиры — в статистику, пробы, маршруты и прокси — в домен", async () => {
    const t = make({ id: "n1", appliedVersion: 0 });

    await t.service.onMetrics("a1", {
      at: 1000,
      host: { cpuPercent: 1 },
      workers: {
        wg: {
          interfaces: [{ name: "wg0", peers: [] }],
          tunnels: [{ name: "wgt0", rttMs: 1, lossPercent: 0 }],
          forwards: [{ id: "f1", activeRoute: "direct" }],
          nodeProbes: [{ nodeId: "n2", rttMs: 2, lossPercent: 0 }],
        },
        socks: {
          proxies: [{ id: "s1", connections: 1, rxBytes: 1, txBytes: 1 }],
        },
      },
    });

    expect(t.ingest.ingest.firstCall.args[1]).to.deep.include({
      collectedAt: 1000,
      interfaces: [{ name: "wg0", peers: [] }],
    });
    expect(t.links.recordProbes.calledOnce).to.equal(true);
    expect(t.forwards.recordRoutes.firstCall.args).to.deep.equal([
      "n1",
      [{ id: "f1", activeRoute: "direct" }],
    ]);
    expect(t.mesh.recordProbes.calledOnce).to.equal(true);
    expect(t.socks.recordStats.calledOnce).to.equal(true);
  });

  it("повтор точки (та же at от агента) — пропуск: старые счётчики не считаются сбросом", async () => {
    const t = make({ id: "n1", appliedVersion: 0 });
    const point = { at: 2000, workers: { wg: { interfaces: [] } } };

    await t.service.onMetrics("a1", point);
    await t.service.onMetrics("a1", point);
    await t.service.onMetrics("a2", point);
    expect(t.ingest.ingest.callCount).to.equal(2);
  });

  it("итог применения: версия и ошибка ноды, статусы интерфейсов; итог старой версии — пропускается", async () => {
    const t = make({ id: "n1", appliedVersion: 5 });
    const node = { id: "n1", appliedVersion: 5 } as any;

    await t.service.applyResult(node, {
      version: 6,
      appliedAt: 1,
      interfaces: [{ name: "wg0", status: "up" }],
      errors: ["wgt0: чужой туннель"],
    });
    expect(t.nodes.applyAgentState.firstCall.args[1]).to.deep.equal({
      appliedVersion: 6,
      applyError: "wgt0: чужой туннель",
    });
    expect(t.interfaces.updateReportedStatuses.firstCall.args[1]).to.deep.equal(
      [{ name: "wg0", status: "up", message: null }],
    );

    await t.service.applyResult(node, {
      version: 4,
      appliedAt: 1,
      interfaces: [],
    });
    expect(t.nodes.applyAgentState.callCount).to.equal(1);
  });

  it("отказ воркера в настройке wg/state — ошибка ноды; применённая и другие ключи — без реакции", async () => {
    const t = make({ id: "n1", appliedVersion: 0 });
    const applied = (key: string, ok: boolean | undefined, error?: object) =>
      ({ agentId: "a1", worker: "wg", key, version: 3, ok, error }) as any;

    await t.service.onConfigApplied(applied("probes", false));
    await t.service.onConfigApplied(applied("state", true));
    expect(t.nodes.findByAgentId.called).to.equal(false);

    await t.service.onConfigApplied(
      applied("state", false, {
        code: "CONFIG_REJECTED",
        message: "плохое состояние",
      }),
    );
    expect(t.nodes.applyAgentState.firstCall.args[1]).to.deep.equal({
      applyError: "плохое состояние",
    });
  });

  it("node.info — сведения ноды слиянием и версия wg", async () => {
    const t = make({ id: "n1", appliedVersion: 0 });

    await t.service.onNodeInfo("a1", {
      wgVersion: "wireguard-tools v1.0.20210914",
      wgMode: "kernel",
      distro: "Debian 12",
      udpPorts: [51820],
      tcpPorts: [22],
    });
    expect(t.nodes.applyAgentState.firstCall.args[1]).to.deep.equal({
      osInfoPatch: {
        set: {
          wgMode: "kernel",
          distro: "Debian 12",
          udpPorts: [51820],
          tcpPorts: [22],
        },
      },
      wgVersion: "wireguard-tools v1.0.20210914",
    });

    await t.service.onNodeInfo("a1", "не объект");
    expect(t.nodes.applyAgentState.callCount).to.equal(1);
  });
});
