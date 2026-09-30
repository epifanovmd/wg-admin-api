import { expect } from "chai";

import {
  Actor,
  call,
  eventually,
  expectStatus,
  items,
  signIn,
  signInAdmin,
  signUp,
} from "./client";

/** Вызов от имени агента (api-ключ ноды). */
const agent = <T = any>(
  key: string,
  method: string,
  path: string,
  body?: unknown,
) => call<T>(key, method, path, body, { scheme: "ApiKey" });

const agentState = async (key: string) =>
  expectStatus(
    await agent(key, "GET", "/api/v1/wg-agent/state?knownVersion=-1&waitMs=0"),
    200,
  ).data;

describe("wireguard", () => {
  let admin: Actor;
  let user: Actor;
  let nodeA: any;
  let nodeAKey: string;
  let relayNode: any;
  let relayKey: string;
  let endpoint: any;
  let iface: any;
  let peer1: any;
  let peer2: any;

  before(async () => {
    admin = await signInAdmin();
    user = await signUp("wg-user");
  });

  describe("ноды", () => {
    it("админ создаёт ноды, ключ агента выдаётся один раз", async () => {
      const resA = expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", {
          name: "node-a",
          publicHost: "203.0.113.10",
          description: "Целевая нода",
        }),
        201,
      );

      nodeA = resA.data.node;
      nodeAKey = resA.data.agentKey;
      expect(nodeAKey).to.include(".");
      expect(nodeA.status).to.equal("created");

      const resB = expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", {
          name: "relay-node",
          publicHost: "203.0.113.20",
        }),
        201,
      );

      relayNode = resB.data.node;
      relayKey = resB.data.agentKey;
    });

    it("дубль имени — 409", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", { name: "node-a" }),
        409,
        "WG_NODE_NAME_TAKEN",
      );
    });

    it("список, options, карточка, изменение", async () => {
      const list = expectStatus(
        await call(admin, "GET", "/api/v1/wg/nodes?query=node"),
        200,
      );

      expect(items(list.data).length).to.be.at.least(2);

      const options = expectStatus(
        await call(admin, "GET", "/api/v1/wg/nodes/options"),
        200,
      );

      expect(options.data.some((o: any) => o.name === "node-a")).to.equal(true);

      expectStatus(
        await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
        200,
      );

      const updated = expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/nodes/${nodeA.id}`, {
          description: "Германия",
        }),
        200,
      );

      expect(updated.data.description).to.equal("Германия");
    });

    it("обычному пользователю ноды недоступны", async () => {
      expectStatus(await call(user, "GET", "/api/v1/wg/nodes"), 403);
      expectStatus(
        await call(user, "POST", "/api/v1/wg/nodes", { name: "x" }),
        403,
      );
    });

    it("ротация ключа агента: старый ключ перестаёт работать", async () => {
      const res = expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${relayNode.id}/agent-key`),
        201,
      );
      const oldKey = relayKey;

      relayKey = res.data.agentKey;
      expectStatus(
        await agent(oldKey, "GET", "/api/v1/wg-agent/state?waitMs=0"),
        401,
      );
    });
    it("область «свои»: создатель и назначенный владелец видят и меняют только свои ноды", async () => {
      const tenant = await signUp("wg-node-tenant");

      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/setPrivileges/${tenant.id}`, {
          roles: ["user"],
          permissions: [
            "wg:node:create",
            "wg:node:view:own",
            "wg:node:update:own",
          ],
        }),
        200,
      );

      const actor = await signIn(tenant.email, tenant.password);
      const created = expectStatus(
        await call(actor, "POST", "/api/v1/wg/nodes", { name: "tenant-node" }),
        201,
      ).data.node;

      expect(created.createdById).to.equal(tenant.id);
      expect(created.ownerId).to.equal(null);

      // Чужого владельца без права назначения не поставить.
      expectStatus(
        await call(actor, "POST", "/api/v1/wg/nodes", {
          name: "tenant-node-2",
          ownerId: user.id,
        }),
        403,
        "WG_NODE_FORBIDDEN",
      );

      const list = expectStatus(
        await call(actor, "GET", "/api/v1/wg/nodes"),
        200,
      );

      expect(items(list.data).map((n: any) => n.id)).to.deep.equal([
        created.id,
      ]);

      // Чужая нода не раскрывается.
      expectStatus(
        await call(actor, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
        404,
        "WG_NODE_NOT_FOUND",
      );

      const assigned = expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${nodeA.id}/assign`, {
          userId: tenant.id,
        }),
        200,
      );

      expect(assigned.data.ownerId).to.equal(tenant.id);

      const options = expectStatus(
        await call(actor, "GET", "/api/v1/wg/nodes/options"),
        200,
      );

      expect(options.data.map((o: any) => o.id)).to.have.members([
        created.id,
        nodeA.id,
      ]);
      expectStatus(
        await call(actor, "PATCH", `/api/v1/wg/nodes/${created.id}`, {
          description: "своя",
        }),
        200,
      );
      // Видимая, но без права на действие — 403.
      expectStatus(
        await call(actor, "DELETE", `/api/v1/wg/nodes/${created.id}`),
        403,
      );

      const revoked = expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${nodeA.id}/revoke`),
        200,
      );

      expect(revoked.data.ownerId).to.equal(null);
      expectStatus(
        await call(actor, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
        404,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${created.id}`),
        204,
      );
    });
  });

  describe("точки подключения", () => {
    it("создание relay-точки с IPIP-пробросом", async () => {
      const res = expectStatus(
        await call(admin, "POST", "/api/v1/wg/endpoints", {
          name: "relay-1",
          host: "vpn.example.com",
          mode: "relay",
          relayNodeId: relayNode.id,
          forwardMode: "ipip",
        }),
        201,
      );

      endpoint = res.data;
      expect(endpoint.forwardMode).to.equal("ipip");
    });

    it("relay без релей-ноды — 400", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/endpoints", {
          name: "bad",
          host: "1.2.3.4",
          mode: "relay",
        }),
        400,
      );
    });

    it("список, options, карточка", async () => {
      expectStatus(await call(admin, "GET", "/api/v1/wg/endpoints"), 200);
      expectStatus(
        await call(admin, "GET", "/api/v1/wg/endpoints/options"),
        200,
      );
      expectStatus(
        await call(admin, "GET", `/api/v1/wg/endpoints/${endpoint.id}`),
        200,
      );
    });
  });

  describe("интерфейсы", () => {
    it("создание интерфейса с точкой подключения", async () => {
      const res = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg0",
          listenPort: 51820,
          addressCidr: "10.10.0.1/24",
          addressV6Cidr: "fd00:10::1/64",
          dns: "1.1.1.1, 8.8.8.8",
          endpointId: endpoint.id,
        }),
        201,
      );

      iface = res.data;
      expect(iface.publicKey).to.have.length(44);
      expect(iface.clientEndpoint).to.equal("vpn.example.com:51820");
    });

    it("интерфейс на самой релей-ноде точки — 409", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: relayNode.id,
          name: "wg0",
          listenPort: 51830,
          addressCidr: "10.13.0.1/24",
          endpointId: endpoint.id,
        }),
        409,
        "WG_IFACE_ENDPOINT_RELAY_IS_NODE",
      );
    });

    it("релеем точки нельзя сделать ноду её интерфейсов — 409", async () => {
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/endpoints/${endpoint.id}`, {
          relayNodeId: nodeA.id,
        }),
        409,
        "WG_ENDPOINT_RELAY_IS_TARGET",
      );
    });

    it("listen-порт релей-ноды занят её пробросом — 409", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: relayNode.id,
          name: "wg5",
          listenPort: 51820,
          addressCidr: "10.14.0.1/24",
        }),
        409,
        "WG_IFACE_PORT_FORWARDED",
      );
    });

    it("порт другой точки того же релея занят — 409", async () => {
      const second = expectStatus(
        await call(admin, "POST", "/api/v1/wg/endpoints", {
          name: "relay-2",
          host: "vpn2.example.com",
          mode: "relay",
          relayNodeId: relayNode.id,
          forwardMode: "dnat",
        }),
        201,
      ).data;

      expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg6",
          listenPort: 51826,
          endpointPort: 51820,
          addressCidr: "10.15.0.1/24",
          endpointId: second.id,
        }),
        409,
        "WG_IFACE_RELAY_PORT_TAKEN",
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/endpoints/${second.id}`),
        204,
      );
    });

    it("перенос интерфейса на другую ноду: ключ сохраняется, конфиги нод обновляются", async () => {
      const created = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg7",
          listenPort: 51827,
          addressCidr: "10.17.0.1/24",
        }),
        201,
      ).data;
      const moved = expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${created.id}/move`, {
          nodeId: relayNode.id,
        }),
        200,
      ).data;

      expect(moved.nodeId).to.equal(relayNode.id);
      expect(moved.publicKey).to.equal(created.publicKey);

      const relayState = await agentState(relayKey);
      const nodeAState = await agentState(nodeAKey);

      expect(relayState.interfaces.map((i: any) => i.name)).to.include("wg7");
      expect(nodeAState.interfaces.map((i: any) => i.name)).to.not.include(
        "wg7",
      );
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${created.id}/move`, {
          nodeId: relayNode.id,
        }),
        400,
        "WG_IFACE_MOVE_SAME_NODE",
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${created.id}`),
        204,
      );
    });

    it("второй интерфейс за той же точкой — релей получает новый проброс", async () => {
      const relayBefore = await agentState(relayKey);
      const second = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg8",
          listenPort: 51828,
          addressCidr: "10.18.0.1/24",
          endpointId: endpoint.id,
        }),
        201,
      ).data;
      const relayAfter = await agentState(relayKey);

      expect(relayAfter.version).to.be.greaterThan(relayBefore.version);
      expect(relayAfter.forwards.map((f: any) => f.listenPort)).to.include(
        51828,
      );

      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${second.id}`),
        204,
      );
      expect(
        (await agentState(relayKey)).forwards.map((f: any) => f.listenPort),
      ).to.not.include(51828);
    });

    it("перенос на релей своей точки — 409", async () => {
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/move`, {
          nodeId: relayNode.id,
        }),
        409,
        "WG_IFACE_ENDPOINT_RELAY_IS_NODE",
      );
    });

    it("конфликт порта на ноде — 409", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg1",
          listenPort: 51820,
          addressCidr: "10.11.0.1/24",
        }),
        409,
        "WG_IFACE_PORT_TAKEN",
      );
    });

    it("произвольные хуки без права wg:interface:hooks — 403", async () => {
      expectStatus(
        await call(user, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg9",
          listenPort: 51999,
          addressCidr: "10.12.0.1/24",
          customPostUp: "reboot",
        }),
        403,
      );
    });

    it("список, options, карточка, изменение DNS", async () => {
      expectStatus(
        await call(admin, "GET", `/api/v1/wg/interfaces?nodeId=${nodeA.id}`),
        200,
      );
      expectStatus(
        await call(admin, "GET", "/api/v1/wg/interfaces/options"),
        200,
      );
      expectStatus(
        await call(admin, "GET", `/api/v1/wg/interfaces/${iface.id}`),
        200,
      );

      const updated = expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/interfaces/${iface.id}`, {
          dns: "9.9.9.9",
        }),
        200,
      );

      expect(updated.data.dns).to.equal("9.9.9.9");
    });

    it("выключение и включение (желаемое состояние)", async () => {
      const off = expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/disable`),
        200,
      );

      expect(off.data.enabled).to.equal(false);

      const on = expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/enable`),
        200,
      );

      expect(on.data.enabled).to.equal(true);
    });
  });

  describe("пиры", () => {
    it("создание: ключи и адреса выделяются автоматически", async () => {
      const res = expectStatus(
        await call(admin, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "phone",
          userId: user.id,
        }),
        201,
      );

      peer1 = res.data;
      expect(peer1.addressV4).to.equal("10.10.0.2");
      expect(peer1.addressV6).to.equal("fd00:10::2");
      expect(peer1.hasPrivateKey).to.equal(true);
      expect(peer1.hasPresharedKey).to.equal(true);
    });

    it("импорт по публичному ключу — без приватного ключа", async () => {
      const res = expectStatus(
        await call(admin, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "imported",
          publicKey: "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=",
          withPresharedKey: false,
        }),
        201,
      );

      peer2 = res.data;
      expect(peer2.hasPrivateKey).to.equal(false);
      expect(peer2.addressV4).to.equal("10.10.0.3");
    });

    it("дубль имени на интерфейсе — 409", async () => {
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "phone",
        }),
        409,
      );
    });

    it("список, options, карточка, изменение", async () => {
      const list = expectStatus(
        await call(admin, "GET", `/api/v1/wg/peers?interfaceId=${iface.id}`),
        200,
      );

      expect(items(list.data)).to.have.length(2);
      expectStatus(await call(admin, "GET", "/api/v1/wg/peers/options"), 200);
      expectStatus(
        await call(admin, "GET", `/api/v1/wg/peers/${peer1.id}`),
        200,
      );

      const updated = expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/peers/${peer1.id}`, {
          clientAllowedIPs: "10.10.0.0/24",
          persistentKeepalive: 15,
        }),
        200,
      );

      expect(updated.data.clientAllowedIPs).to.equal("10.10.0.0/24");
    });

    it("пользователь видит только свои пиры", async () => {
      const list = expectStatus(
        await call(user, "GET", "/api/v1/wg/peers"),
        200,
      );

      expect(items(list.data)).to.have.length(1);
      expect(items(list.data)[0].id).to.equal(peer1.id);
      expectStatus(
        await call(user, "GET", `/api/v1/wg/peers/${peer2.id}`),
        404,
      );
      expectStatus(
        await call(user, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "hack",
        }),
        403,
      );
    });

    it("конфиг и QR: держатель получает свои", async () => {
      const config = expectStatus(
        await call(user, "GET", `/api/v1/wg/peers/${peer1.id}/config`),
        200,
      );

      expect(config.data).to.include("[Interface]");
      expect(config.data).to.include("Endpoint = vpn.example.com:51820");
      expect(config.data).to.include("DNS = 9.9.9.9");
      expect(config.data).to.include("AllowedIPs = 10.10.0.0/24");

      const qr = expectStatus(
        await call(user, "GET", `/api/v1/wg/peers/${peer1.id}/qr`),
        200,
      );

      expect(qr.data.dataUrl).to.match(/^data:image\/png;base64,/);
    });

    it("конфиг импортированного пира — 409", async () => {
      expectStatus(
        await call(admin, "GET", `/api/v1/wg/peers/${peer2.id}/config`),
        409,
        "WG_PEER_NO_PRIVATE_KEY",
      );
    });

    it("держатель выключает и включает свой пир", async () => {
      const off = expectStatus(
        await call(user, "POST", `/api/v1/wg/peers/${peer1.id}/disable`),
        200,
      );

      expect(off.data.enabled).to.equal(false);
      expect(off.data.disabledReason).to.equal("manual");
      expectStatus(
        await call(user, "POST", `/api/v1/wg/peers/${peer1.id}/enable`),
        200,
      );
      // Чужой пир держателю недоступен даже на выключение.
      expectStatus(
        await call(user, "POST", `/api/v1/wg/peers/${peer2.id}/disable`),
        404,
      );
    });

    it("ротация и удаление PSK", async () => {
      const rotated = expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer1.id}/psk/rotate`),
        200,
      );

      expect(rotated.data.hasPresharedKey).to.equal(true);

      const removed = expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/peers/${peer1.id}/psk`),
        200,
      );

      expect(removed.data.hasPresharedKey).to.equal(false);
    });

    it("назначение и отвязка держателя", async () => {
      const assigned = expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer2.id}/assign`, {
          userId: user.id,
        }),
        200,
      );

      expect(assigned.data.userId).to.equal(user.id);

      const revoked = expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer2.id}/revoke`),
        200,
      );

      expect(revoked.data.userId).to.equal(null);
    });

    it("область «свои»: создатель видит пир без держателя; видит все — меняет только свои", async () => {
      const editor = await signUp("wg-editor");

      expectStatus(
        await call(admin, "PATCH", `/api/v1/user/setPrivileges/${editor.id}`, {
          roles: ["user"],
          permissions: [
            "wg:peer:create",
            "wg:peer:view",
            "wg:peer:update:own",
            "wg:peer:delete:own",
          ],
        }),
        200,
      );

      const fresh = await signIn(editor.email, editor.password);
      const created = expectStatus(
        await call(fresh, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "editor-peer",
        }),
        201,
      );

      expect(created.data.userId).to.equal(null);
      expect(created.data.createdById).to.equal(editor.id);

      // Чужого держателя без права назначения не поставить.
      expectStatus(
        await call(fresh, "POST", "/api/v1/wg/peers", {
          interfaceId: iface.id,
          name: "editor-peer-2",
          userId: user.id,
        }),
        403,
        "WG_PEER_FORBIDDEN",
      );

      const all = expectStatus(
        await call(fresh, "GET", `/api/v1/wg/peers?interfaceId=${iface.id}`),
        200,
      );

      expect(items(all.data).map((p: any) => p.id)).to.include.members([
        created.data.id,
        peer2.id,
      ]);

      expectStatus(
        await call(fresh, "PATCH", `/api/v1/wg/peers/${created.data.id}`, {
          description: "своё",
        }),
        200,
      );
      expectStatus(
        await call(fresh, "PATCH", `/api/v1/wg/peers/${peer2.id}`, {
          description: "чужое",
        }),
        403,
        "WG_PEER_FORBIDDEN",
      );

      // Роль user видит только свои пиры: созданный редактором ей не виден.
      expectStatus(
        await call(user, "GET", `/api/v1/wg/peers/${created.data.id}`),
        404,
      );
      expectStatus(
        await call(fresh, "DELETE", `/api/v1/wg/peers/${created.data.id}`),
        204,
      );
    });
  });

  describe("агент", () => {
    let stateVersion: number;

    it("desired state: интерфейс, пиры и IPIP-туннель целевой ноды", async () => {
      const state = await agentState(nodeAKey);

      stateVersion = state.version;
      expect(state.nodeId).to.equal(nodeA.id);
      expect(state.interfaces).to.have.length(1);

      const wg0 = state.interfaces[0];

      expect(wg0.name).to.equal("wg0");
      expect(wg0.privateKey).to.have.length(44);
      expect(wg0.peers.length).to.be.at.least(2);
      // Нода — цель relay-точки: агент должен поднять свой конец туннеля.
      expect(state.tunnels).to.have.length(1);
      expect(state.tunnels[0].remoteHost).to.equal("203.0.113.20");
    });

    it("long-poll просыпается сразу после изменения (NOTIFY триггера)", async () => {
      const current = await agentState(nodeAKey);
      const poll = agent(
        nodeAKey,
        "GET",
        `/api/v1/wg-agent/state?knownVersion=${current.version}&waitMs=20000`,
      );

      await new Promise(resolve => setTimeout(resolve, 300));

      const changedAt = Date.now();

      expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer1.id}/disable`),
        200,
      );

      const res = expectStatus(await poll, 200).data;

      expect(res.version).to.be.greaterThan(current.version);
      expect(Date.now() - changedAt).to.be.lessThan(700);
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer1.id}/enable`),
        200,
      );
      stateVersion = (await agentState(nodeAKey)).version;
    });

    it("desired state релея: туннель и проброс UDP", async () => {
      const state = await agentState(relayKey);

      expect(state.tunnels).to.have.length(1);
      expect(state.forwards).to.have.length(1);
      expect(state.forwards[0]).to.include({
        proto: "udp",
        listenPort: 51820,
        targetPort: 51820,
      });
      expect(state.forwards[0].targetIp).to.equal(
        state.tunnels[0].remoteTunnelIp,
      );
    });

    it("агент: версия и бинари, установщик, обновление с sha256", async () => {
      const binaryHash =
        "6e160e6aef0f531d7c11433f82d0e8da577debca1bd9c02ff2c8c7184f9f2cda";
      const release = expectStatus(
        await call(admin, "GET", "/api/v1/wg/agent/release"),
        200,
      ).data;

      expect(release).to.deep.equal({
        version: "2.0.0",
        hashes: { amd64: binaryHash },
      });

      // Архитектура ноды ещё не известна — бинаря для неё нет.
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/agent/nodes/${nodeA.id}/update`),
        404,
        "WG_AGENT_BINARY_NOT_BUILT",
      );

      expectStatus(
        await agent(nodeAKey, "POST", "/api/v1/wg-agent/state", {
          agentVersion: "2.0.0",
          os: { arch: "amd64" },
        }),
        204,
      );

      const command = expectStatus(
        await call(admin, "POST", `/api/v1/wg/agent/nodes/${nodeA.id}/update`),
        201,
      ).data;

      expect(command.type).to.equal("agent-update");
      expect(command.payload.hash).to.equal(binaryHash);
      expect(
        (await agentState(nodeAKey)).commands.map((c: any) => c.id),
      ).to.include(command.id);

      const binary = await agent(
        nodeAKey,
        "GET",
        "/api/v1/wg-agent/binary/amd64",
      );

      expect(binary.status).to.equal(200);
      expect(binary.data).to.equal("AMD64-AGENT-BINARY");
      expect(binary.headers.get("x-agent-sha256")).to.equal(binaryHash);
      expectStatus(
        await agent(nodeAKey, "GET", "/api/v1/wg-agent/binary/arm64"),
        404,
        "WG_AGENT_BINARY_NOT_BUILT",
      );
      expect(
        (await call(null, "GET", "/api/v1/wg-agent/binary/amd64")).status,
      ).to.equal(401);

      // Установщик публичный: без секретов, бинарь — по ключу агента. Идёт
      // сразу после бинаря того же контроллера — заголовки не протекают.
      const script = await call(null, "GET", "/api/v1/wg-agent/install.sh");

      expect(script.status).to.equal(200);
      expect(script.headers.get("x-agent-sha256")).to.equal(null);
      expect(script.data).to.include("#!/bin/sh");
      expect(script.data).to.include("BACKEND_URL='");
      expect(script.data).to.not.include(nodeAKey);

      expectStatus(
        await agent(nodeAKey, "POST", "/api/v1/wg-agent/state", {
          codeHash: binaryHash,
        }),
        204,
      );
      expect(
        expectStatus(
          await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
          200,
        ).data.agentCodeHash,
      ).to.equal(binaryHash);
      expectStatus(
        await call(user, "POST", `/api/v1/wg/agent/nodes/${nodeA.id}/update`),
        403,
      );
      expectStatus(
        await agent(
          nodeAKey,
          "POST",
          `/api/v1/wg-agent/commands/${command.id}/complete`,
          { exitCode: 0 },
        ),
        204,
      );
    });

    it("связность нод: цели проверки и матрица", async () => {
      const state = await agentState(nodeAKey);

      expect(state.probeTargets).to.deep.include({
        nodeId: relayNode.id,
        host: "203.0.113.20",
      });
      expect(
        state.probeTargets.some((t: any) => t.nodeId === nodeA.id),
      ).to.equal(false);

      expectStatus(
        await agent(nodeAKey, "POST", "/api/v1/wg-agent/stats", {
          interfaces: [],
          nodeProbes: [{ nodeId: relayNode.id, rttMs: 61.2, lossPercent: 0 }],
        }),
        204,
      );

      const mesh = expectStatus(
        await call(admin, "GET", "/api/v1/wg/stats/mesh"),
        200,
      ).data;

      expect(mesh.nodes.map((n: any) => n.id)).to.include.members([
        nodeA.id,
        relayNode.id,
      ]);
      expect(mesh.cells).to.deep.include({
        fromNodeId: nodeA.id,
        toNodeId: relayNode.id,
        rttMs: 61.2,
        lossPercent: 0,
        ts: mesh.cells.find((c: any) => c.fromNodeId === nodeA.id).ts,
      });
      expectStatus(await call(user, "GET", "/api/v1/wg/stats/mesh"), 403);
    });

    it("пробросы на внешние сервисы: UDP через туннель с аварийным путём, TCP напрямую", async () => {
      const udp = expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "wg-server",
          relayNodeId: relayNode.id,
          protocol: "udp",
          listenPort: 51900,
          targetNodeId: nodeA.id,
          targetPort: 51820,
          path: "ipip",
        }),
        201,
      ).data;
      const tcp = expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "socks-tls",
          relayNodeId: relayNode.id,
          protocol: "tcp",
          listenPort: 8443,
          targetHost: "198.51.100.50",
          targetPort: 8443,
          path: "direct",
        }),
        201,
      ).data;

      expect(udp.route).to.equal("auto");

      const state = await agentState(relayKey);
      const tunnel = state.tunnels[0];
      const udpRule = state.forwards.find((f: any) => f.id === udp.id);
      const tcpRule = state.forwards.find((f: any) => f.id === tcp.id);

      expect(udpRule).to.deep.include({
        proto: "udp",
        listenPort: 51900,
        targetIp: tunnel.remoteTunnelIp,
        targetPort: 51820,
        fallbackIp: "203.0.113.10",
        route: "auto",
        tunnel: tunnel.name,
      });
      expect(tcpRule).to.deep.include({
        proto: "tcp",
        listenPort: 8443,
        targetIp: "198.51.100.50",
        targetPort: 8443,
      });

      // Порт проброса занят для точек и интерфейсов, и наоборот.
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "clash",
          relayNodeId: relayNode.id,
          protocol: "udp",
          listenPort: 51820,
          targetHost: "198.51.100.51",
          targetPort: 51820,
          path: "direct",
        }),
        409,
        "WG_FORWARD_PORT_TAKEN",
      );
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg10",
          listenPort: 51910,
          endpointPort: 51900,
          addressCidr: "10.20.0.1/24",
          endpointId: endpoint.id,
        }),
        409,
        "WG_IFACE_RELAY_PORT_TAKEN",
      );
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "bad-ipip",
          relayNodeId: relayNode.id,
          protocol: "udp",
          listenPort: 51901,
          targetHost: "198.51.100.52",
          targetPort: 51820,
          path: "ipip",
        }),
        400,
        "WG_FORWARD_IPIP_NEEDS_NODE",
      );
      expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "self",
          relayNodeId: relayNode.id,
          protocol: "udp",
          listenPort: 51902,
          targetNodeId: relayNode.id,
          targetPort: 51820,
          path: "ipip",
        }),
        409,
        "WG_FORWARD_TARGET_IS_RELAY",
      );

      // Агент релея сообщает, что туннель лёг и проброс идёт напрямую.
      expectStatus(
        await agent(relayKey, "POST", "/api/v1/wg-agent/stats", {
          interfaces: [],
          forwards: [{ id: udp.id, activeRoute: "direct" }],
        }),
        204,
      );
      expect(
        expectStatus(
          await call(admin, "GET", `/api/v1/wg/forwards/${udp.id}`),
          200,
        ).data.activeRoute,
      ).to.equal("direct");
      expectStatus(await call(user, "GET", "/api/v1/wg/forwards"), 403);

      // Ручное переключение: принудительно напрямую — агент применит сразу.
      expect(
        expectStatus(
          await call(admin, "PATCH", `/api/v1/wg/forwards/${udp.id}`, {
            route: "direct",
          }),
          200,
        ).data.route,
      ).to.equal("direct");
      expect(
        (await agentState(relayKey)).forwards.find((f: any) => f.id === udp.id)
          .route,
      ).to.equal("direct");

      for (const id of [udp.id, tcp.id]) {
        expectStatus(
          await call(admin, "DELETE", `/api/v1/wg/forwards/${id}`),
          204,
        );
      }
      expect(
        (await agentState(relayKey)).forwards.map((f: any) => f.id),
      ).to.not.include.members([udp.id, tcp.id]);
    });

    it("выключенный проброс порт не держит: перевод интерфейса на точку через релей; включение при занятом порту — 409", async () => {
      const manual = expectStatus(
        await call(admin, "POST", "/api/v1/wg/forwards", {
          name: "manual-wg",
          relayNodeId: relayNode.id,
          protocol: "udp",
          listenPort: 51950,
          targetNodeId: nodeA.id,
          targetPort: 51950,
          path: "ipip",
        }),
        201,
      ).data;
      const wg5 = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: nodeA.id,
          name: "wg5",
          listenPort: 51950,
          addressCidr: "10.195.0.1/24",
        }),
        201,
      ).data;
      const attach = () =>
        call(admin, "PATCH", `/api/v1/wg/interfaces/${wg5.id}`, {
          endpointId: endpoint.id,
        });

      // Включённый проброс держит порт на релее.
      expectStatus(await attach(), 409, "WG_IFACE_RELAY_PORT_TAKEN");

      // Выключили — порт свободен: интерфейс переходит на точку через релей.
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/forwards/${manual.id}`, {
          enabled: false,
        }),
        200,
      );
      expect(expectStatus(await attach(), 200).data.endpointId).to.equal(
        endpoint.id,
      );

      // Выключенный проброс можно править; включить, пока порт у точки, — нельзя.
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/forwards/${manual.id}`, {
          name: "manual-wg-old",
        }),
        200,
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/forwards/${manual.id}`, {
          enabled: true,
        }),
        409,
        "WG_FORWARD_PORT_TAKEN",
      );
      expect(
        (await agentState(relayKey)).forwards.map((f: any) => f.id),
      ).to.not.include(manual.id);

      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${wg5.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/forwards/${manual.id}`),
        204,
      );
    });

    it("реплики интерфейса: копия на ноде, общие пиры, кандидаты релея, закрепление, обслуживающая копия", async () => {
      const created = expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", {
          name: "replica-c",
          publicHost: "203.0.113.30",
        }),
        201,
      ).data;
      const nodeC = created.node;
      const nodeCKey = created.agentKey;

      const withReplica = expectStatus(
        await call(
          admin,
          "POST",
          `/api/v1/wg/interfaces/${iface.id}/replicas`,
          {
            nodeId: nodeC.id,
          },
        ),
        201,
      ).data;

      expect(withReplica.replicas.map((r: any) => r.nodeId)).to.deep.equal([
        nodeC.id,
      ]);
      // Агента на ноде копии ещё нет — UI показывает «ожидает агента».
      expect(withReplica.replicas[0].nodeStatus).to.equal("created");
      expect(withReplica.nodeStatus).to.be.a("string");

      // Список интерфейсов — с копиями; viaRelay — только за точками через релей.
      const viaRelay = expectStatus(
        await call(admin, "GET", "/api/v1/wg/interfaces?viaRelay=true"),
        200,
      ).data.items;
      const listed = viaRelay.find((i: any) => i.id === iface.id);

      expect(listed.replicas.map((r: any) => r.nodeId)).to.deep.equal([
        nodeC.id,
      ]);
      expect(listed.replicas[0].nodeName).to.equal("replica-c");
      expect(viaRelay.every((i: any) => i.endpointId === endpoint.id)).to.equal(
        true,
      );

      // hostNodeId — всё, что работает на ноде: основные и копии чужих.
      const elsewhere = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: relayNode.id,
          name: "wg7",
          listenPort: 51970,
          addressCidr: "10.197.0.1/24",
        }),
        201,
      ).data;
      const onC = expectStatus(
        await call(
          admin,
          "GET",
          `/api/v1/wg/interfaces?hostNodeId=${nodeC.id}`,
        ),
        200,
      ).data.items;

      expect(onC.map((i: any) => i.id)).to.deep.equal([iface.id]);
      expect(
        expectStatus(
          await call(admin, "GET", `/api/v1/wg/interfaces?nodeId=${nodeC.id}`),
          200,
        ).data.items,
      ).to.deep.equal([]);
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${elsewhere.id}`),
        204,
      );

      // Точка знает свои интерфейсы и ноды их копий — «куда ведёт».
      const withTargets = expectStatus(
        await call(admin, "GET", `/api/v1/wg/endpoints/${endpoint.id}`),
        200,
      ).data;
      const target = withTargets.interfaces.find(
        (i: any) => i.interfaceId === iface.id,
      );

      expect(target).to.include({
        interfaceName: iface.name,
        nodeId: iface.nodeId,
        port: iface.endpointPort ?? iface.listenPort,
      });
      expect(target.copyNodeIds).to.deep.equal([nodeC.id]);

      // Тот же ключ и те же пиры на копии.
      const primaryWg0 = (await agentState(nodeAKey)).interfaces.find(
        (i: any) => i.name === "wg0",
      );
      const stateC = await agentState(nodeCKey);
      const replicaWg0 = stateC.interfaces.find((i: any) => i.name === "wg0");

      expect(replicaWg0.privateKey).to.equal(primaryWg0.privateKey);
      expect(replicaWg0.peers.map((p: any) => p.publicKey)).to.deep.equal(
        primaryWg0.peers.map((p: any) => p.publicKey),
      );

      // Изменение пира доходит до копии.
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer1.id}/disable`),
        200,
      );
      expect((await agentState(nodeCKey)).version).to.be.greaterThan(
        stateC.version,
      );
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/peers/${peer1.id}/enable`),
        200,
      );

      // Релей: туннели до обеих копий. Копия ещё не поднялась (агент не
      // отчитался) — в резерв не попадает: релей не шлёт трафик туда, где
      // интерфейса нет, даже если нода отвечает на пинг.
      const relayForward = (state: any) =>
        state.forwards.find((f: any) => f.id === iface.id);
      // Пути релея по порядку: [нода, туннель | напрямую].
      const paths = (state: any) =>
        relayForward(state).candidates?.map((c: any) => [
          c.nodeId,
          c.tunnel ? "tunnel" : "direct",
        ]);
      const relayState = await agentState(relayKey);

      expect(relayState.tunnels).to.have.length(2);
      // Маршрут auto: туннель до основной, при его отказе — её прямой адрес.
      expect(paths(relayState)).to.deep.equal([
        [nodeA.id, "tunnel"],
        [nodeA.id, "direct"],
      ]);

      const reportReplica = async (status: string) =>
        expectStatus(
          await agent(nodeCKey, "POST", "/api/v1/wg-agent/state", {
            interfaces: [{ name: "wg0", status }],
          }),
          204,
        );

      // Копия поднялась — релей получает новую версию с резервом по приоритету.
      await reportReplica("up");

      const relayWithReplica = await agentState(relayKey);

      expect(relayWithReplica.version).to.be.greaterThan(relayState.version);
      expect(paths(relayWithReplica)).to.deep.equal([
        [nodeA.id, "tunnel"],
        [nodeA.id, "direct"],
        [nodeC.id, "tunnel"],
        [nodeC.id, "direct"],
      ]);

      // Копия упала — из резерва выходит; поднялась снова — возвращается.
      await reportReplica("error");
      // Закрепить трафик на неподнятой копии нельзя — клиенты остались бы без связи.
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/interfaces/${iface.id}`, {
          activeReplicaNodeId: nodeC.id,
        }),
        409,
        "WG_IFACE_ACTIVE_REPLICA_DOWN",
      );
      expect(paths(await agentState(relayKey))).to.deep.equal([
        [nodeA.id, "tunnel"],
        [nodeA.id, "direct"],
      ]);
      await reportReplica("up");

      // Маршрут точки: только туннель / напрямую — релей получает новую версию.
      const setRoute = async (route: string) =>
        expect(
          expectStatus(
            await call(admin, "PATCH", `/api/v1/wg/endpoints/${endpoint.id}`, {
              route,
            }),
            200,
          ).data.route,
        ).to.equal(route);

      await setRoute("tunnel");
      expect(paths(await agentState(relayKey))).to.deep.equal([
        [nodeA.id, "tunnel"],
        [nodeC.id, "tunnel"],
      ]);
      await setRoute("direct");
      expect(paths(await agentState(relayKey))).to.deep.equal([
        [nodeA.id, "direct"],
        [nodeC.id, "direct"],
      ]);
      await setRoute("auto");

      // Ручное закрепление копии и возврат в авто.
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/interfaces/${iface.id}`, {
          activeReplicaNodeId: nodeC.id,
        }),
        200,
      );
      expect(paths(await agentState(relayKey))).to.deep.equal([
        [nodeC.id, "tunnel"],
        [nodeC.id, "direct"],
      ]);
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/interfaces/${iface.id}`, {
          activeReplicaNodeId: relayNode.id,
        }),
        400,
        "WG_IFACE_ACTIVE_REPLICA_INVALID",
      );
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/interfaces/${iface.id}`, {
          activeReplicaNodeId: null,
        }),
        200,
      );

      // Отчёт релея о копии, обслуживающей трафик; статус копии.
      expectStatus(
        await agent(relayKey, "POST", "/api/v1/wg-agent/stats", {
          interfaces: [],
          forwards: [
            {
              id: iface.id,
              activeRoute: "tunnel",
              activeCandidate: 1,
              activeNodeId: nodeC.id,
            },
          ],
        }),
        204,
      );

      const current = expectStatus(
        await call(admin, "GET", `/api/v1/wg/interfaces/${iface.id}`),
        200,
      ).data;

      expect(current.servingNodeId).to.equal(nodeC.id);
      // Через что приходят клиенты: точка, её режим и релей — для UI.
      expect(current.endpoint).to.deep.equal({
        name: endpoint.name,
        mode: "relay",
        relayNodeId: relayNode.id,
        relayNodeName: relayNode.name,
      });
      expect(current.replicas[0].status).to.equal("up");

      // Ошибки.
      for (const [nodeId, status, code] of [
        [nodeA.id, 400, "WG_IFACE_REPLICA_IS_PRIMARY"],
        [nodeC.id, 409, "WG_IFACE_REPLICA_EXISTS"],
        [relayNode.id, 409, "WG_IFACE_ENDPOINT_RELAY_IS_NODE"],
      ] as const) {
        expectStatus(
          await call(
            admin,
            "POST",
            `/api/v1/wg/interfaces/${iface.id}/replicas`,
            {
              nodeId,
            },
          ),
          status,
          code,
        );
      }
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/move`, {
          nodeId: nodeC.id,
        }),
        409,
        "WG_IFACE_MOVE_TO_REPLICA",
      );

      // Удаление реплики: копия снимается, у релея снова один путь.
      expectStatus(
        await call(
          admin,
          "DELETE",
          `/api/v1/wg/interfaces/${iface.id}/replicas/${nodeC.id}`,
        ),
        204,
      );
      expect(
        (await agentState(nodeCKey)).interfaces.map((i: any) => i.name),
      ).to.not.include("wg0");
      expect(paths(await agentState(relayKey))).to.deep.equal([
        [nodeA.id, "tunnel"],
        [nodeA.id, "direct"],
      ]);
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${nodeC.id}`),
        204,
      );
      stateVersion = (await agentState(nodeAKey)).version;
    });

    it("здоровье туннеля: проба релея видна обеим нодам", async () => {
      const tunnelName = (await agentState(relayKey)).tunnels[0].name;

      expectStatus(
        await agent(relayKey, "POST", "/api/v1/wg-agent/stats", {
          interfaces: [],
          tunnels: [{ name: tunnelName, rttMs: 42.5, lossPercent: 0 }],
        }),
        204,
      );

      const links = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/links/node/${nodeA.id}`),
        200,
      ).data;

      expect(links).to.have.length(1);
      expect(links[0]).to.include({
        role: "target",
        counterpartNodeId: relayNode.id,
        tunnelName,
        rttMs: 42.5,
        status: "ok",
      });
      expectStatus(
        await call(user, "GET", `/api/v1/wg/stats/links/node/${nodeA.id}`),
        403,
      );
    });

    it("отчёт агента: нода online и inSync, интерфейс up", async () => {
      expectStatus(
        await agent(nodeAKey, "POST", "/api/v1/wg-agent/state", {
          appliedVersion: stateVersion,
          applyError: null,
          agentVersion: "1.0.0-e2e",
          wgVersion: "wireguard-tools v1.0.0",
          os: {
            distro: "Ubuntu 24.04",
            hostname: "node-a",
            wgMode: "userspace",
            udpPorts: [53, 51820],
          },
          interfaces: [{ name: "wg0", status: "up" }],
        }),
        204,
      );

      const node = expectStatus(
        await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
        200,
      );

      expect(node.data.status).to.equal("online");
      expect(node.data.inSync).to.equal(true);
      expect(node.data.osInfo.distro).to.equal("Ubuntu 24.04");
      expect(node.data.osInfo.wgMode).to.equal("userspace");
      expect(node.data.osInfo.udpPorts).to.deep.equal([53, 51820]);
      // IP, с которого агент ходит к бэкенду, — подсказка для publicHost.
      expect(node.data.agentRemoteIp).to.be.a("string");
      expect(node.data.agentRemoteIp.length).to.be.greaterThan(0);

      const ifaceRes = expectStatus(
        await call(admin, "GET", `/api/v1/wg/interfaces/${iface.id}`),
        200,
      );

      expect(ifaceRes.data.status).to.equal("up");
    });

    it("статистика: скорость, handshake, история и overview", async () => {
      const handshake = Math.floor(Date.now() / 1000) - 5;
      const stats = (rx: number, tx: number) => ({
        sys: {
          cpuPercent: 12.5,
          load1: 0.4,
          load5: 0.3,
          load15: 0.2,
          nics: [{ name: "eth0", rxBps: 1000, txBps: 2000 }],
          conntrackCount: 120,
          conntrackMax: 262144,
          memUsedBytes: 512 * 1024 * 1024,
          memTotalBytes: 1024 * 1024 * 1024,
          diskUsedBytes: 5 * 1024 ** 3,
          diskTotalBytes: 20 * 1024 ** 3,
          uptimeSec: 3600,
        },
        interfaces: [
          {
            name: "wg0",
            peers: [
              {
                publicKey: peer1.publicKey,
                rxBytes: rx,
                txBytes: tx,
                lastHandshake: handshake,
                endpoint: "198.51.100.7:33333",
              },
            ],
          },
        ],
      });

      expectStatus(
        await agent(
          nodeAKey,
          "POST",
          "/api/v1/wg-agent/stats",
          stats(100_000, 50_000),
        ),
        204,
      );
      expectStatus(
        await agent(
          nodeAKey,
          "POST",
          "/api/v1/wg-agent/stats",
          stats(300_000, 90_000),
        ),
        204,
      );

      const peer = await eventually(async () => {
        const res = await call(admin, "GET", `/api/v1/wg/peers/${peer1.id}`);

        return res.data.lastHandshakeAt ? res.data : null;
      });

      expect(peer.isOnline).to.equal(true);
      expect(peer.lastEndpoint).to.equal("198.51.100.7:33333");
      expect(peer.rxBytesTotal).to.be.at.least(100_000);

      const current = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/current/peer/${peer1.id}`),
        200,
      );

      expect(current.data.rxTotal).to.equal(300_000);

      const nodeLive = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/current/node/${nodeA.id}`),
        200,
      );

      expect(nodeLive.data.sys.nics).to.deep.equal([
        { name: "eth0", rxBps: 1000, txBps: 2000 },
      ]);
      expect(nodeLive.data.sys.conntrackMax).to.equal(262144);

      const ifaceLive = expectStatus(
        await call(
          admin,
          "GET",
          `/api/v1/wg/stats/current/interface/${iface.id}`,
        ),
        200,
      );

      expect(ifaceLive.data.peersOnline).to.be.at.least(1);

      const overview = expectStatus(
        await call(admin, "GET", "/api/v1/wg/stats/overview"),
        200,
      );

      expect(overview.data.nodes.online).to.be.at.least(1);
      expect(overview.data.peers.online).to.be.at.least(1);

      const series = expectStatus(
        await call(
          admin,
          "GET",
          `/api/v1/wg/stats/series?peerId=${peer1.id}&groupBy=peer&stepSec=60`,
        ),
        200,
      );

      expect(series.data.length).to.be.at.least(1);
      expect(series.data[0].points.length).to.be.at.least(1);

      const metrics = expectStatus(
        await call(
          admin,
          "GET",
          `/api/v1/wg/stats/node-metrics?nodeId=${nodeA.id}`,
        ),
        200,
      );

      expect(metrics.data.length).to.be.at.least(1);
      expect(metrics.data[0].memTotalBytes).to.equal(1024 * 1024 * 1024);
    });

    it("статистика держателя: overview и серии по своим пирам", async () => {
      const overview = expectStatus(
        await call(user, "GET", "/api/v1/wg/stats/overview"),
        200,
      );

      expect(overview.data.peers.total).to.equal(1);

      expectStatus(
        await call(user, "GET", "/api/v1/wg/stats/series?groupBy=peer"),
        200,
      );
      expectStatus(
        await call(user, "GET", `/api/v1/wg/stats/current/peer/${peer1.id}`),
        200,
      );
      // Чужая нода держателю недоступна.
      expectStatus(
        await call(user, "GET", `/api/v1/wg/stats/current/node/${nodeA.id}`),
        403,
      );
    });
  });

  describe("команды агенту и журнал", () => {
    it("журнал агента приходит синхронно", async () => {
      // Логи ждут ответа агента: обслуживаем команду параллельно запросу.
      const logsPromise = call(
        admin,
        "GET",
        `/api/v1/wg/nodes/${nodeA.id}/logs?lines=50`,
      );
      const logCommand = await eventually(async () => {
        const state = await agentState(nodeAKey);

        return state.commands.find((c: any) => c.type === "agent-logs");
      });

      await agent(
        nodeAKey,
        "POST",
        `/api/v1/wg-agent/commands/${logCommand.id}/output`,
        { chunk: "2026-09-27 INFO агент работает" },
      );
      await agent(
        nodeAKey,
        "POST",
        `/api/v1/wg-agent/commands/${logCommand.id}/complete`,
        { exitCode: 0 },
      );

      const logs = expectStatus(await logsPromise, 200);

      expect(logs.data.content).to.include("агент работает");
    });

    it("перезапуск интерфейса — команда агенту", async () => {
      const created = expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/restart`),
        201,
      );

      expect(created.data.type).to.equal("interface-restart");
      expect(created.data.payload.interfaceName).to.equal("wg0");
      // Агент другой ноды чужую команду не берёт.
      expectStatus(
        await agent(
          relayKey,
          "POST",
          `/api/v1/wg-agent/commands/${created.data.id}/ack`,
        ),
        404,
        "WG_NODE_COMMAND_NOT_FOUND",
      );
      // Агент подтверждает, чтобы команда не висела.
      await agent(
        nodeAKey,
        "POST",
        `/api/v1/wg-agent/commands/${created.data.id}/ack`,
      );
      await agent(
        nodeAKey,
        "POST",
        `/api/v1/wg-agent/commands/${created.data.id}/complete`,
        { exitCode: 0 },
      );
    });
  });

  describe("установка агента (provision)", () => {
    it("постановка задачи установки по SSH", async () => {
      const created = expectStatus(
        await call(admin, "POST", "/api/v1/wg/nodes", { name: "fresh-vps" }),
        201,
      );
      const res = expectStatus(
        await call(
          admin,
          "POST",
          `/api/v1/wg/nodes/${created.data.node.id}/provision`,
          {
            host: "127.0.0.1",
            port: 2299,
            username: "root",
            password: "e2e-password",
          },
        ),
        202,
      );

      expect(res.data.jobId).to.be.a("string");

      const node = expectStatus(
        await call(admin, "GET", `/api/v1/wg/nodes/${created.data.node.id}`),
        200,
      );

      expect(node.data.status).to.equal("provisioning");

      // Хост недостижим: задача завершится ошибкой, нода перейдёт в error.
      await eventually(
        async () => {
          const check = await call(
            admin,
            "GET",
            `/api/v1/wg/nodes/${created.data.node.id}`,
          );

          return check.data.status === "error" ? check.data : null;
        },
        { timeoutMs: 30_000, what: "нода в статусе error" },
      );

      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${created.data.node.id}`),
        204,
      );
    });
  });

  describe("смена publicHost ноды", () => {
    it("связанная нода получает новую версию и новый адрес туннеля", async () => {
      const before = await agentState(nodeAKey);

      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/nodes/${relayNode.id}`, {
          publicHost: "203.0.113.21",
        }),
        200,
      );

      const after = await eventually(
        async () => {
          const state = await agentState(nodeAKey);

          return state.version > before.version ? state : null;
        },
        { timeoutMs: 10_000, what: "новая версия у целевой ноды" },
      );

      expect(after.tunnels[0].remoteHost).to.equal("203.0.113.21");
      expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/nodes/${relayNode.id}`, {
          publicHost: "203.0.113.20",
        }),
        200,
      );
    });
  });

  describe("удаление агента (uninstall)", () => {
    it("задача удаления по SSH; без ключа — 400, без права — 403; хост недостижим — задача падает, агент не отвязан", async () => {
      expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${nodeA.id}/uninstall`, {
          host: "127.0.0.1",
        }),
        400,
      );
      expectStatus(
        await call(user, "POST", `/api/v1/wg/nodes/${nodeA.id}/uninstall`, {
          host: "127.0.0.1",
          password: "x",
        }),
        403,
      );

      const res = expectStatus(
        await call(admin, "POST", `/api/v1/wg/nodes/${nodeA.id}/uninstall`, {
          host: "127.0.0.1",
          port: 2299,
          username: "root",
          password: "e2e-password",
        }),
        202,
      );

      const job = await eventually(
        async () => {
          const check = await call(
            admin,
            "GET",
            `/api/v1/jobs/${res.data.jobId}`,
          );

          return check.data.status === "failed" ? check.data : null;
        },
        { timeoutMs: 30_000, what: "задача удаления упала" },
      );

      expect(job.scopeType).to.equal("wg-node");
      expect(
        expectStatus(
          await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
          200,
        ).data.hasAgentKey,
      ).to.equal(true);
    });
  });

  describe("изменение точки подключения без перевыпуска конфигов", () => {
    it("смена хоста точки меняет endpoint в конфигах и версию нод", async () => {
      const before = expectStatus(
        await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`),
        200,
      );
      const updated = expectStatus(
        await call(admin, "PATCH", `/api/v1/wg/endpoints/${endpoint.id}`, {
          host: "new-vpn.example.com",
        }),
        200,
      );

      expect(updated.data.host).to.equal("new-vpn.example.com");

      // Пир получает конфиг уже с новым адресом — без пересоздания.
      const config = await eventually(async () => {
        const res = await call(
          user,
          "GET",
          `/api/v1/wg/peers/${peer1.id}/config`,
        );

        return String(res.data).includes("new-vpn.example.com")
          ? res.data
          : null;
      });

      expect(config).to.include("Endpoint = new-vpn.example.com:51820");

      // Затронутые ноды получили новую версию конфигурации.
      await eventually(async () => {
        const res = await call(admin, "GET", `/api/v1/wg/nodes/${nodeA.id}`);

        return res.data.configVersion > before.data.configVersion
          ? res.data
          : null;
      });
    });
  });

  describe("удаление", () => {
    it("нода с интерфейсами не удаляется — 409", async () => {
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${nodeA.id}`),
        409,
        "WG_NODE_HAS_INTERFACES",
      );
    });

    it("интерфейс с пирами не удаляется — 409", async () => {
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`),
        409,
        "WG_IFACE_HAS_PEERS",
      );
    });

    it("каскад руками: пиры → интерфейс → точка → ноды", async () => {
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/peers/${peer2.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/peers/${peer1.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/endpoints/${endpoint.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${nodeA.id}`),
        204,
      );
      expectStatus(
        await call(admin, "DELETE", `/api/v1/wg/nodes/${relayNode.id}`),
        204,
      );
    });
  });
});
