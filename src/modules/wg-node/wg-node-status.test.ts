import { expect } from "chai";

import { EWgNodeStatus } from "./wg-node.types";
import { wgNodeStateOf, wgNodeStatusOf } from "./wg-node-status";

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
  it("ОС — от агента, режим wg и порты — от воркера wg; без ответа воркера ОС не трогается", () => {
    const state = wgNodeStateOf(
      agent({
        version: "1.0.1",
        address: "203.0.113.5",
        lastSeenAt: 1000,
        host: { os: "linux", arch: "amd64", hostname: "n1", kernel: "6.8" },
        workers: [
          worker("wg", {
            health: {
              ok: true,
              info: {
                wgVersion: "wireguard-tools v1.0.20210914",
                wgMode: "kernel",
                distro: "Debian 12",
                udpPorts: [51820, "x"],
              },
            },
          }),
          worker("socks"),
        ],
      }),
    );

    expect(state).to.deep.include({
      agentVersion: "1.0.1",
      wgVersion: "wireguard-tools v1.0.20210914",
      agentRemoteIp: "203.0.113.5",
    });
    expect(state.osInfo).to.deep.include({
      platform: "linux",
      arch: "amd64",
      distro: "Debian 12",
      wgMode: "kernel",
      udpPorts: [51820],
    });
    expect(
      wgNodeStateOf(
        agent({
          host: { os: "linux", arch: "amd64", hostname: "n1" },
          workers: [worker("wg", { health: undefined }), worker("socks")],
        }),
      ),
    ).to.not.have.property("osInfo");
  });
});
