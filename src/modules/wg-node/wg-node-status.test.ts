import { expect } from "chai";

import { EWgNodeStatus } from "./wg-node.types";
import {
  wgNodeStateOf,
  wgNodeStatusOf,
  workerOsInfoPatch,
} from "./wg-node-status";

const worker = (name: string, patch: Record<string, unknown> = {}) => ({
  name,
  state: "running",
  restarts: 0,
  health: { ok: true },
  ...patch,
});

const agent = (patch: Record<string, unknown> = {}) =>
  ({
    id: "a".repeat(32),
    name: "node",
    labels: {},
    online: true,
    revoked: false,
    enrolledAt: 1,
    workers: [worker("wg"), worker("socks")],
    alerts: [],
    ...patch,
  }) as any;

describe("wgNodeStatusOf", () => {
  it("на связи и воркеры работают — online; без связи — offline; отозван — created", () => {
    expect(wgNodeStatusOf(agent()).status).to.equal(EWgNodeStatus.Online);
    expect(wgNodeStatusOf(agent({ online: false })).status).to.equal(
      EWgNodeStatus.Offline,
    );
    expect(wgNodeStatusOf(agent({ revoked: true }))).to.deep.equal({
      status: EWgNodeStatus.Created,
      statusMessage: "Агент отозван",
    });
  });

  it("беда воркера — error с пояснением; нет воркера в настройках — тоже", () => {
    const invalid = wgNodeStatusOf(
      agent({
        workers: [
          worker("wg", { state: "invalid", message: "нет манифеста" }),
          worker("socks"),
        ],
      }),
    );

    expect(invalid.status).to.equal(EWgNodeStatus.Error);
    expect(invalid.statusMessage).to.include("нет манифеста");
    expect(
      wgNodeStatusOf(agent({ workers: [worker("wg")] })).statusMessage,
    ).to.include("socks");
    expect(
      wgNodeStatusOf(
        agent({
          workers: [
            worker("wg", { health: { ok: false, message: "нет wg-quick" } }),
            worker("socks"),
          ],
        }),
      ).statusMessage,
    ).to.include("нет wg-quick");
  });
});

describe("wgNodeStateOf", () => {
  it("ОС — от агента слиянием в osInfo (режим wg и порты воркера не затираются)", () => {
    const state = wgNodeStateOf(
      agent({
        version: "1.0.1",
        remoteIp: "203.0.113.5",
        lastSeenAt: 1000,
        host: { os: "linux", arch: "amd64", hostname: "n1", kernel: "6.8" },
      }),
    );

    expect(state).to.deep.include({
      agentVersion: "1.0.1",
      agentRemoteIp: "203.0.113.5",
    });
    expect(state.osInfoPatch).to.deep.equal({
      set: { platform: "linux", arch: "amd64", hostname: "n1", kernel: "6.8" },
    });
    expect(state).to.not.have.property("osInfo");
    expect(wgNodeStateOf(agent())).to.not.have.property("osInfoPatch");
  });
});

describe("workerOsInfoPatch", () => {
  it("сведения воркера wg — слиянием; неверные значения отброшены, нет режима — убрать", () => {
    expect(
      workerOsInfoPatch({
        wgMode: "userspace",
        distro: "Debian 12",
        udpPorts: [51820, "x"],
        tcpPorts: "нет",
      }),
    ).to.deep.equal({
      set: { wgMode: "userspace", distro: "Debian 12", udpPorts: [51820] },
    });
    expect(workerOsInfoPatch({ wgMode: null })).to.deep.equal({
      set: {},
      remove: ["wgMode"],
    });
  });
});
