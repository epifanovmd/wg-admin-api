import { expect } from "chai";

import { Actor, call, expectStatus, signInAdmin, signUp } from "./client";
import { connectSocket, TestSocket } from "./socket";

const agent = (key: string, method: string, path: string, body?: unknown) =>
  call(key, method, path, body, { scheme: "ApiKey" });

const agentStats = async (key: string, body: Record<string, unknown>) =>
  expectStatus(
    await agent(key, "POST", "/api/v1/wg-agent/stats", {
      interfaces: [],
      ...body,
    }),
    204,
  );

describe("wireguard: обновления по сокетам", () => {
  let admin: Actor;
  let user: Actor;
  let ws: TestSocket;
  let relay: { id: string; key: string };
  let target: { id: string; key: string };

  const createNode = async (name: string, publicHost: string) => {
    const { data } = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", { name, publicHost }),
      201,
    );

    return { id: data.node.id as string, key: data.agentKey as string };
  };

  before(async () => {
    admin = await signInAdmin();
    user = await signUp("wg-realtime-user");
    ws = await connectSocket(admin);
    relay = await createNode("rt-relay", "203.0.113.90");
    target = await createNode("rt-target", "203.0.113.91");
  });

  after(async () => {
    ws?.close();
    for (const node of [target, relay]) {
      await call(admin, "DELETE", `/api/v1/wg/nodes/${node.id}`);
    }
  });

  it("подписка сразу после подключения не теряется", async () => {
    const fresh = await connectSocket(admin);

    try {
      expect(await fresh.join("wg-overview")).to.deep.equal({ ok: true });
    } finally {
      fresh.close();
    }
  });

  it("комнаты списков — только с правом", async () => {
    const lists = [
      "wg-forwards",
      "wg-socks",
      "wg-endpoints",
      "wg-nodes",
      "wg-interfaces",
      "wg-peers",
      "users",
      "roles",
      "api-keys",
      "audit",
    ];

    for (const type of lists) {
      expect(await ws.join(type), type).to.deep.equal({ ok: true });
    }
    expect(await ws.join("wg-overview")).to.deep.equal({ ok: true });

    const stranger = await connectSocket(user);

    try {
      for (const type of lists) {
        expect(await stranger.join(type), type).to.deep.equal({ ok: false });
      }
    } finally {
      stranger.close();
    }
  });

  it("отзыв права выводит сокет из комнаты: user:privileges-changed и room:revoked", async () => {
    const viewer = await signUp("wg-rt-viewer");

    expectStatus(
      await call(admin, "PATCH", `/api/v1/user/setPrivileges/${viewer.id}`, {
        roles: ["user"],
        permissions: ["wg:endpoint:view"],
      }),
      200,
    );

    const refreshed = expectStatus(
      await call(null, "POST", "/api/v1/auth/refresh", {
        refreshToken: viewer.refresh,
      }),
      200,
    ).data;
    const socket = await connectSocket({
      ...viewer,
      access: (refreshed.tokens ?? refreshed).accessToken,
    });

    try {
      expect(await socket.join("wg-endpoints")).to.deep.equal({ ok: true });

      const changed = socket.next<any>("user:privileges-changed");
      const revoked = socket.next<any>("room:revoked");

      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/setPrivileges/${viewer.id}`, {
          roles: ["user"],
          permissions: [],
        }),
        200,
      );

      expect((await changed).permissions).to.not.include("wg:endpoint:view");
      expect(await revoked).to.deep.equal({ type: "wg-endpoints", id: "all" });
    } finally {
      socket.close();
    }
  });

  it("пир ушёл к другому держателю — прежнему wg:peer:deleted", async () => {
    const iface = expectStatus(
      await call(admin, "POST", "/api/v1/wg/interfaces", {
        nodeId: target.id,
        name: "wg7",
        listenPort: 51897,
        addressCidr: "10.197.0.1/24",
      }),
      201,
    ).data;
    const peer = expectStatus(
      await call(admin, "POST", "/api/v1/wg/peers", {
        interfaceId: iface.id,
        name: "rt-peer",
        userId: user.id,
      }),
      201,
    ).data;
    const holder = await connectSocket(user);

    try {
      const gone = holder.next<any>("wg:peer:deleted", d => d.id === peer.id);
      const updated = ws.next<any>(
        "wg:peer:updated",
        p => p.id === peer.id && p.userId === admin.id,
      );
      const assigned = expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer.id}/assign`, {
          userId: admin.id,
        }),
        200,
      ).data;

      await gone;
      // Имена в событии — те же, что в ответе REST.
      expect(assigned.userName).to.be.a("string");
      expect(await updated).to.include({
        userName: assigned.userName,
        createdByName: assigned.createdByName,
      });
    } finally {
      holder.close();
      await call(admin, "DELETE", `/api/v1/wg/peers/${peer.id}`);
      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`);
    }
  });

  it("проброс: создание, смена маршрута по отчёту агента (без повторов), удаление", async () => {
    const created = ws.next<any>(
      "wg:forward:updated",
      f => f.name === "rt-fwd",
    );
    const forward = expectStatus(
      await call(admin, "POST", "/api/v1/wg/forwards", {
        name: "rt-fwd",
        relayNodeId: relay.id,
        protocol: "udp",
        listenPort: 51990,
        targetNodeId: target.id,
        targetPort: 51820,
        path: "ipip",
      }),
      201,
    ).data;

    expect(await created).to.include({
      id: forward.id,
      createdByName: forward.createdByName,
      ownerName: null,
    });
    expect(forward.createdByName).to.be.a("string");

    const routed = ws.next<any>(
      "wg:forward:updated",
      f => f.id === forward.id && f.activeRoute === "direct",
    );

    await agentStats(relay.key, {
      forwards: [{ id: forward.id, activeRoute: "direct" }],
    });
    await routed;

    const repeat = ws.none(
      "wg:forward:updated",
      (f: any) => f.id === forward.id,
    );

    await agentStats(relay.key, {
      forwards: [{ id: forward.id, activeRoute: "direct" }],
    });
    await repeat;

    const deleted = ws.next<any>(
      "wg:forward:deleted",
      d => d.id === forward.id,
    );

    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/forwards/${forward.id}`),
      204,
    );
    await deleted;
  });

  it("прокси: изменения, пользователи и статистика (только при изменении)", async () => {
    const created = ws.next<any>(
      "wg:socks:updated",
      s => s.name === "rt-socks",
    );
    const service = expectStatus(
      await call(admin, "POST", "/api/v1/wg/socks", {
        name: "rt-socks",
        nodeId: target.id,
        listenPort: 8455,
      }),
      201,
    ).data;

    expect(await created).to.include({
      id: service.id,
      createdByName: service.createdByName,
      ownerName: null,
    });
    expect(service.createdByName).to.be.a("string");

    const withUser = ws.next<any>(
      "wg:socks:updated",
      s => s.id === service.id && s.users.length === 1,
    );

    expectStatus(
      await call(admin, "POST", `/api/v1/wg/socks/${service.id}/users`, {
        username: "tg",
      }),
      201,
    );
    await withUser;

    const stats = ws.next<any>("wg:socks:stats", s => s.id === service.id);
    const report = [
      { id: service.id, connections: 2, rxBytes: 100, txBytes: 400 },
    ];

    await agentStats(target.key, { socks: report });
    expect((await stats).live).to.include({ connections: 2, txBytes: 400 });

    const repeat = ws.none("wg:socks:stats", (s: any) => s.id === service.id);

    await agentStats(target.key, { socks: report });
    await repeat;

    const deleted = ws.next<any>("wg:socks:deleted", d => d.id === service.id);

    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/socks/${service.id}`),
      204,
    );
    await deleted;
  });

  it("точка подключения и линк релея: здоровье линка — в комнаты обеих нод", async () => {
    const created = ws.next<any>(
      "wg:endpoint:updated",
      e => e.name === "rt-ep",
    );
    const endpoint = expectStatus(
      await call(admin, "POST", "/api/v1/wg/endpoints", {
        name: "rt-ep",
        host: "rt.example.com",
        mode: "relay",
        relayNodeId: relay.id,
        forwardMode: "ipip",
      }),
      201,
    ).data;

    expect((await created).id).to.equal(endpoint.id);

    const updated = ws.next<any>(
      "wg:endpoint:updated",
      e => e.id === endpoint.id && e.description === "через релей",
    );

    expectStatus(
      await call(admin, "PATCH", `/api/v1/wg/endpoints/${endpoint.id}`, {
        description: "через релей",
      }),
      200,
    );
    await updated;

    // Интерфейс подключили к точке — «куда ведёт» в списке точек.
    const targets = ws.next<any>(
      "wg:endpoint:updated",
      e => e.id === endpoint.id && e.interfaces.length === 1,
    );
    const iface = expectStatus(
      await call(admin, "POST", "/api/v1/wg/interfaces", {
        nodeId: target.id,
        name: "wg9",
        listenPort: 51899,
        addressCidr: "10.199.0.1/24",
        endpointId: endpoint.id,
      }),
      201,
    ).data;

    expect((await targets).interfaces[0]).to.include({
      interfaceId: iface.id,
      interfaceName: "wg9",
      nodeId: target.id,
      port: 51899,
    });

    // Точку переименовали — DTO интерфейса с новой точкой.
    const renamed = ws.next<any>(
      "wg:interface:updated",
      i => i.id === iface.id && i.endpoint?.name === "rt-ep-2",
    );

    expectStatus(
      await call(admin, "PATCH", `/api/v1/wg/endpoints/${endpoint.id}`, {
        name: "rt-ep-2",
      }),
      200,
    );
    expect((await renamed).endpoint).to.include({
      mode: "relay",
      relayNodeId: relay.id,
      relayNodeName: "rt-relay",
    });

    expect(await ws.join("wg-node", target.id)).to.deep.equal({ ok: true });

    const state = expectStatus(
      await agent(
        relay.key,
        "GET",
        "/api/v1/wg-agent/state?knownVersion=-1&waitMs=0",
      ),
      200,
    ).data;
    const tunnelName = state.tunnels[0].name;
    const links = ws.next<any>("wg:node:links", l => l.nodeId === target.id);

    await agentStats(relay.key, {
      tunnels: [{ name: tunnelName, rttMs: 12.5, lossPercent: 0 }],
    });
    expect((await links).links[0]).to.include({
      role: "target",
      counterpartNodeId: relay.id,
      rttMs: 12.5,
      status: "ok",
    });

    const detached = ws.next<any>(
      "wg:endpoint:updated",
      e => e.id === endpoint.id && e.interfaces.length === 0,
    );

    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`),
      204,
    );
    await detached;

    const deleted = ws.next<any>(
      "wg:endpoint:deleted",
      d => d.id === endpoint.id,
    );

    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/endpoints/${endpoint.id}`),
      204,
    );
    await deleted;
  });

  it("статус интерфейса из отчёта агента (основная копия и реплика) — в комнату списка интерфейсов, DTO полный", async () => {
    const iface = expectStatus(
      await call(admin, "POST", "/api/v1/wg/interfaces", {
        nodeId: target.id,
        name: "wg8",
        listenPort: 51898,
        addressCidr: "10.198.0.1/24",
      }),
      201,
    ).data;

    expectStatus(
      await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/replicas`, {
        nodeId: relay.id,
      }),
      201,
    );

    const targetPage = await connectSocket(admin);
    const relayPage = await connectSocket(admin);

    try {
      expect(await targetPage.join("wg-interfaces")).to.deep.equal({
        ok: true,
      });
      expect(await relayPage.join("wg-interfaces")).to.deep.equal({
        ok: true,
      });

      const primary = targetPage.next<any>(
        "wg:interface:updated",
        i => i.id === iface.id && i.status === "error",
      );

      expectStatus(
        await agent(target.key, "POST", "/api/v1/wg-agent/state", {
          interfaces: [{ name: "wg8", status: "error", message: "denied" }],
        }),
        204,
      );

      const updated = await primary;

      expect(updated.statusMessage).to.equal("denied");
      expect(updated.nodeName).to.equal("rt-target");
      expect(updated.replicas).to.have.length(1);

      const replica = relayPage.next<any>(
        "wg:interface:updated",
        i =>
          i.id === iface.id &&
          i.replicas.some(
            (r: any) => r.nodeId === relay.id && r.status === "up",
          ),
      );

      expectStatus(
        await agent(relay.key, "POST", "/api/v1/wg-agent/state", {
          interfaces: [{ name: "wg8", status: "up" }],
        }),
        204,
      );
      await replica;

      const deleted = [targetPage, relayPage].map(page =>
        page.next<any>("wg:interface:deleted", d => d.id === iface.id),
      );

      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`),
        204,
      );
      await Promise.all(deleted);
    } finally {
      targetPage.close();
      relayPage.close();
      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`);
    }
  });

  it("статистика пиров — одной пачкой на комнату: обзор, интерфейс, «мои пиры», карточка пира только со своим пиром; короткий ряд; повтор тика не учитывается", async () => {
    const iface = expectStatus(
      await call(admin, "POST", "/api/v1/wg/interfaces", {
        nodeId: target.id,
        name: "wg7",
        listenPort: 51897,
        addressCidr: "10.197.0.1/24",
      }),
      201,
    ).data;
    const peer = expectStatus(
      await call(admin, "POST", "/api/v1/wg/peers", {
        interfaceId: iface.id,
        name: "rt-peer",
        userId: user.id,
      }),
      201,
    ).data;
    const second = expectStatus(
      await call(admin, "POST", "/api/v1/wg/peers", {
        interfaceId: iface.id,
        name: "rt-peer-2",
        userId: user.id,
      }),
      201,
    ).data;
    const interfacePage = await connectSocket(admin);
    const holder = await connectSocket(user);
    const holderList = await connectSocket(user);
    const tick = (seq: number, rxBytes: number) => {
      const now = Date.now();

      return {
        seq,
        bootId: "e2e-boot",
        collectedAt: now,
        sentAt: now,
        interfaces: [
          {
            name: "wg7",
            peers: [peer, second].map(item => ({
              publicKey: item.publicKey,
              rxBytes,
              txBytes: 2000,
              lastHandshake: Math.floor(now / 1000),
              endpoint: "198.51.100.9:40000",
            })),
          },
        ],
      };
    };
    const hasPeer = (batch: any) =>
      batch.peers.some((live: any) => live.peerId === peer.id);

    try {
      expect(await interfacePage.join("wg-interface", iface.id)).to.deep.equal({
        ok: true,
      });

      // Вкладка обзора, открывшая и интерфейс, получает тик один раз.
      expect(await ws.join("wg-interface", iface.id)).to.deep.equal({
        ok: true,
      });

      // Держатель: карточка одного пира и (в другой вкладке) список своих.
      expect(await holder.join("wg-peer", peer.id)).to.deep.equal({ ok: true });
      expect(await holderList.join("wg-peers-own", user.id)).to.deep.equal({
        ok: true,
      });
      expect(await holderList.join("wg-peers-own", admin.id)).to.deep.equal({
        ok: false,
      });

      let holderBatches = 0;
      const countHolder = (batch: any) => {
        if (hasPeer(batch)) holderBatches += 1;
      };

      holder.socket.on("wg:peers:stats", countHolder);

      let overviewBatches = 0;
      const countOverview = (batch: any) => {
        if (hasPeer(batch)) overviewBatches += 1;
      };

      ws.socket.on("wg:peers:stats", countOverview);

      const onInterface = interfacePage.next<any>("wg:peers:stats", hasPeer);
      const onOverview = ws.next<any>("wg:peers:stats", hasPeer);
      const onHolder = holder.next<any>("wg:peers:stats", hasPeer);
      const onHolderList = holderList.next<any>("wg:peers:stats", hasPeer);
      const noSingle = holder.none("wg:peer:stats");

      await agentStats(target.key, tick(1, 1000));

      const batch = await onInterface;

      expect(
        batch.peers.every((live: any) => live.interfaceId === iface.id),
      ).to.equal(true);
      expect(
        batch.peers.find((live: any) => live.peerId === peer.id),
      ).to.include({
        online: true,
        endpoint: "198.51.100.9:40000",
      });
      await onOverview;
      // Карточка пира — только он, хотя у держателя пиров два.
      expect((await onHolder).peers.map((l: any) => l.peerId)).to.deep.equal([
        peer.id,
      ]);
      expect(
        (await onHolderList).peers.map((l: any) => l.peerId).sort(),
      ).to.deep.equal([peer.id, second.id].sort());
      await noSingle;
      ws.socket.off("wg:peers:stats", countOverview);
      holder.socket.off("wg:peers:stats", countHolder);
      expect(overviewBatches).to.equal(1);
      expect(holderBatches).to.equal(1);

      // Повтор того же тика (досылка) — трафик не удваивается.
      await agentStats(target.key, tick(1, 999_999));
      await agentStats(target.key, tick(2, 3000));

      const current = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/current/peer/${peer.id}`),
        200,
      ).data;

      expect(current.rxTotal).to.equal(3000);

      const window = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/window/peer/${peer.id}`),
        200,
      ).data;

      expect(window).to.have.length(2);
      expect(window[0]).to.have.keys("ts", "rxBps", "txBps");
      for (const path of [
        `/api/v1/wg/stats/window/interface/${iface.id}`,
        `/api/v1/wg/stats/window/node/${target.id}`,
      ]) {
        expect(
          expectStatus(await call(admin, "GET", path), 200).data,
        ).to.have.length.greaterThan(0);
      }
      expectStatus(
        await call(user, "GET", `/api/v1/wg/stats/window/node/${target.id}`),
        403,
      );
    } finally {
      interfacePage.close();
      holder.close();
      holderList.close();
      await call(admin, "DELETE", `/api/v1/wg/peers/${second.id}`);
      await call(admin, "DELETE", `/api/v1/wg/peers/${peer.id}`);
      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`);
    }
  });

  it("матрица связности нод — в комнату wg-overview после проб агента", async () => {
    const mesh = ws.next<any>("wg:stats:mesh", m =>
      m.cells.some((c: any) => c.fromNodeId === relay.id),
    );

    await agentStats(relay.key, {
      nodeProbes: [{ nodeId: target.id, rttMs: 33.3, lossPercent: 0 }],
    });
    expect((await mesh).cells).to.deep.include.members([
      {
        fromNodeId: relay.id,
        toNodeId: target.id,
        rttMs: 33.3,
        lossPercent: 0,
        ts: (await mesh).cells.find((c: any) => c.fromNodeId === relay.id).ts,
      },
    ]);
  });
});
