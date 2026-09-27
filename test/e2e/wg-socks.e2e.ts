import { expect } from "chai";

import { Actor, call, expectStatus, signInAdmin, signUp } from "./client";

const agentState = async (key: string) =>
  expectStatus(
    await call(
      key,
      "GET",
      "/api/v1/wg-agent/state?knownVersion=-1&waitMs=0",
      undefined,
      { scheme: "ApiKey" },
    ),
    200,
  ).data;

describe("wireguard: прокси SOCKS5 через mTLS", () => {
  let admin: Actor;
  let user: Actor;
  let node: any;
  let nodeKey: string;
  let service: any;
  let socksUser: any;
  let client: any;

  before(async () => {
    admin = await signInAdmin();
    user = await signUp("wg-socks-user");

    const res = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", {
        name: "socks-node",
        publicHost: "203.0.113.70",
      }),
      201,
    );

    node = res.data.node;
    nodeKey = res.data.agentKey;
  });

  it("создание: свой CA, серверный сертификат на имя ноды", async () => {
    service = expectStatus(
      await call(admin, "POST", "/api/v1/wg/socks", {
        name: "tg-proxy",
        nodeId: node.id,
        listenPort: 8444,
      }),
      201,
    ).data;

    expect(service).to.deep.include({
      nodeId: node.id,
      nodeName: "socks-node",
      listenPort: 8444,
      serverName: "203.0.113.70",
      enabled: true,
      clientHost: null,
      clientPort: null,
    });
    expect(JSON.stringify(service)).to.not.include("PRIVATE KEY");
  });

  it("дубль имени и занятый порт — 409; порт прокси закрыт для пробросов", async () => {
    expectStatus(
      await call(admin, "POST", "/api/v1/wg/socks", {
        name: "tg-proxy",
        nodeId: node.id,
        listenPort: 8445,
      }),
      409,
      "WG_SOCKS_NAME_TAKEN",
    );
    expectStatus(
      await call(admin, "POST", "/api/v1/wg/socks", {
        name: "tg-proxy-2",
        nodeId: node.id,
        listenPort: 8444,
      }),
      409,
      "WG_SOCKS_PORT_TAKEN",
    );
    expectStatus(
      await call(admin, "POST", "/api/v1/wg/forwards", {
        name: "socks-clash",
        relayNodeId: node.id,
        protocol: "tcp",
        listenPort: 8444,
        targetHost: "198.51.100.60",
        targetPort: 8443,
        path: "direct",
      }),
      409,
      "WG_FORWARD_PORT_TAKEN",
    );
  });

  it("пользователи: сгенерированный пароль, секрет, выключение", async () => {
    socksUser = expectStatus(
      await call(admin, "POST", `/api/v1/wg/socks/${service.id}/users`, {
        username: "tg",
      }),
      201,
    ).data;

    expect(socksUser.username).to.equal("tg");
    expect(socksUser.password).to.have.length.greaterThan(11);

    expectStatus(
      await call(admin, "POST", `/api/v1/wg/socks/${service.id}/users`, {
        username: "tg",
      }),
      409,
      "WG_SOCKS_USERNAME_TAKEN",
    );

    const card = expectStatus(
      await call(admin, "GET", `/api/v1/wg/socks/${service.id}`),
      200,
    ).data;
    const userId = card.users[0].id;

    socksUser = { ...socksUser, id: userId };

    const secret = expectStatus(
      await call(
        admin,
        "GET",
        `/api/v1/wg/socks/${service.id}/users/${userId}/secret`,
      ),
      200,
    ).data;

    expect(secret).to.deep.equal({
      username: "tg",
      password: socksUser.password,
    });

    const off = expectStatus(
      await call(
        admin,
        "PATCH",
        `/api/v1/wg/socks/${service.id}/users/${userId}`,
        { enabled: false, password: "new-password-1" },
      ),
      200,
    ).data;

    expect(off.password).to.equal("new-password-1");
    expect((await agentState(nodeKey)).socks[0].users).to.deep.equal([]);

    expectStatus(
      await call(
        admin,
        "PATCH",
        `/api/v1/wg/socks/${service.id}/users/${userId}`,
        { enabled: true },
      ),
      200,
    );
  });

  it("клиенты: выпуск, архив для Mac, allowlist агента", async () => {
    client = expectStatus(
      await call(admin, "POST", `/api/v1/wg/socks/${service.id}/clients`, {
        name: "macbook",
      }),
      201,
    ).data;

    expect(client).to.deep.include({
      name: "macbook",
      revoked: false,
    });
    expect(client.fingerprint).to.match(/^[0-9a-f]{64}$/);

    const mac = await call(
      admin,
      "GET",
      `/api/v1/wg/socks/${service.id}/clients/${client.id}/mac`,
    );

    expect(mac.status).to.equal(200);
    expect(mac.headers.get("content-type")).to.include("application/zip");

    const state = await agentState(nodeKey);
    const socks = state.socks.find((item: any) => item.id === service.id);

    expect(socks).to.deep.include({
      listenPort: 8444,
      allowedFingerprints: [client.fingerprint],
    });
    expect(socks.keyPem).to.include("PRIVATE KEY");
    expect(socks.users).to.have.length(1);
    expect(socks.users[0].username).to.equal("tg");
    expect(socks.users[0].hash).to.match(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(socks)).to.not.include("new-password-1");
  });

  it("адрес для клиентов через проброс; архив для Mac выбранного пользователя", async () => {
    const updated = expectStatus(
      await call(admin, "PATCH", `/api/v1/wg/socks/${service.id}`, {
        clientHost: "198.51.100.9",
        clientPort: 8443,
        description: "через проброс",
      }),
      200,
    ).data;

    expect(updated).to.deep.include({
      clientHost: "198.51.100.9",
      clientPort: 8443,
      description: "через проброс",
    });

    const mac = await call(
      admin,
      "GET",
      `/api/v1/wg/socks/${service.id}/clients/${client.id}/mac?userId=${socksUser.id}`,
    );

    expect(mac.status).to.equal(200);
    expect(mac.headers.get("content-type")).to.include("application/zip");
    expect(mac.headers.get("content-disposition")).to.include(
      'filename="tg-proxy-mac.zip"',
    );
    expect(String(mac.data).startsWith("PK")).to.equal(true);
  });

  it("статистика агента видна в карточке", async () => {
    expectStatus(
      await call(
        nodeKey,
        "POST",
        "/api/v1/wg-agent/stats",
        {
          interfaces: [],
          socks: [
            { id: service.id, connections: 3, rxBytes: 1000, txBytes: 5000 },
          ],
        },
        { scheme: "ApiKey" },
      ),
      204,
    );

    const card = expectStatus(
      await call(admin, "GET", `/api/v1/wg/socks/${service.id}`),
      200,
    ).data;

    expect(card.live).to.deep.include({
      connections: 3,
      rxBytes: 1000,
      txBytes: 5000,
    });
  });

  it("отзыв клиента: пропадает из allowlist, архив не выдаётся", async () => {
    const revoked = expectStatus(
      await call(
        admin,
        "POST",
        `/api/v1/wg/socks/${service.id}/clients/${client.id}/revoke`,
      ),
      200,
    ).data;

    expect(revoked.revoked).to.equal(true);

    const socks = (await agentState(nodeKey)).socks.find(
      (item: any) => item.id === service.id,
    );

    expect(socks.allowedFingerprints).to.deep.equal([]);
    expectStatus(
      await call(
        admin,
        "GET",
        `/api/v1/wg/socks/${service.id}/clients/${client.id}/mac`,
      ),
      404,
      "WG_SOCKS_CLIENT_NOT_FOUND",
    );
  });

  it("без права — 403", async () => {
    expectStatus(await call(user, "GET", "/api/v1/wg/socks"), 403);
  });

  it("удаление пользователя и прокси; нода освобождается", async () => {
    expectStatus(
      await call(
        admin,
        "DELETE",
        `/api/v1/wg/socks/${service.id}/users/${socksUser.id}`,
      ),
      204,
    );
    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/socks/${service.id}`),
      204,
    );
    expectStatus(
      await call(admin, "GET", `/api/v1/wg/socks/${service.id}`),
      404,
      "WG_SOCKS_NOT_FOUND",
    );
    expect((await agentState(nodeKey)).socks).to.deep.equal([]);
    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/nodes/${node.id}`),
      204,
    );
  });
});
