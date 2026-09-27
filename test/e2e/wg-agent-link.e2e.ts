import { expect } from "chai";
import WebSocket from "ws";

import { Actor, call, expectStatus, signInAdmin } from "./client";
import { BASE_URL } from "./harness";
import { connectSocket, TestSocket } from "./socket";

const LINK_PATH = "/api/v1/wg-agent/link";

/** Агент на канале постоянной связи: сообщения копятся, ожидание — по условию. */
class TestAgent {
  private readonly _messages: any[] = [];
  private readonly _waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.on("message", data => {
      this._messages.push(JSON.parse(String(data)));
      this._waiters.splice(0).forEach(wake => wake());
    });
  }

  static connect(key: string): Promise<TestAgent> {
    const ws = new WebSocket(BASE_URL.replace(/^http/, "ws") + LINK_PATH, {
      headers: { "X-Api-Key": key, "X-Agent-Link": "1" },
    });

    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(new TestAgent(ws)));
      ws.once("unexpected-response", (_req, res) =>
        reject(new Error(`upgrade ${res.statusCode}`)),
      );
      ws.once("error", reject);
    });
  }

  send(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Первое сообщение (с начала соединения), удовлетворяющее условию. */
  async next(
    match: (message: any) => boolean,
    timeoutMs = 10_000,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const index = this._messages.findIndex(match);

      if (index >= 0) return this._messages.splice(index, 1)[0];
      if (Date.now() >= deadline) {
        throw new Error(
          `нет сообщения за ${timeoutMs} мс: ${JSON.stringify(this._messages)}`,
        );
      }
      await new Promise<void>(resolve => {
        this._waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  closed(): Promise<number> {
    return new Promise(resolve => this.ws.once("close", code => resolve(code)));
  }

  close(): void {
    this.ws.close();
  }
}

const eventually = async <T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await check();

    if (value) return value;
    if (Date.now() >= deadline) throw new Error("условие не выполнилось");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
};

describe("wireguard: канал постоянной связи с агентом", () => {
  let admin: Actor;
  let viewer: TestSocket;
  let node: { id: string; key: string };

  const nodeStatus = async (): Promise<string> =>
    expectStatus(await call(admin, "GET", `/api/v1/wg/nodes/${node.id}`), 200)
      .data.status;

  before(async () => {
    admin = await signInAdmin();
    viewer = await connectSocket(admin);

    const created = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", {
        name: "link-node",
        publicHost: "203.0.113.80",
      }),
      201,
    ).data;

    node = { id: created.node.id, key: created.agentKey };
    expect(await viewer.join("wg-node", node.id)).to.deep.equal({ ok: true });
  });

  after(async () => {
    viewer?.close();
    await call(admin, "DELETE", `/api/v1/wg/nodes/${node.id}`);
  });

  it("без ключа или с чужим ключом соединение не устанавливается", async () => {
    for (const key of ["", "wrong.key"]) {
      try {
        await TestAgent.connect(key);
        expect.fail("соединение установилось");
      } catch (err) {
        expect((err as Error).message).to.equal("upgrade 401");
      }
    }
  });

  it("hello → welcome и состояние; нода online; изменение и команда приходят сами", async () => {
    const agent = await TestAgent.connect(node.key);

    try {
      agent.send({ type: "hello", knownVersion: -1 });

      const welcome = await agent.next(message => message.type === "welcome");

      expect(welcome).to.include({ protocol: 1 });
      expect(welcome.statsIntervalMs).to.be.a("number");

      const first = await agent.next(message => message.type === "state");

      expect(first.state.nodeId).to.equal(node.id);
      expect(await nodeStatus()).to.equal("online");

      // Изменение конфигурации доставляется без запроса агента.
      const iface = expectStatus(
        await call(admin, "POST", "/api/v1/wg/interfaces", {
          nodeId: node.id,
          name: "wg5",
          listenPort: 51895,
          addressCidr: "10.195.0.1/24",
        }),
        201,
      ).data;
      const changed = await agent.next(
        message =>
          message.type === "state" &&
          message.state.interfaces.some((i: any) => i.name === "wg5"),
      );

      expect(changed.state.version).to.be.greaterThan(first.state.version);

      const command = expectStatus(
        await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/restart`),
        201,
      ).data;
      const withCommand = await agent.next(
        message =>
          message.type === "state" &&
          message.state.commands.some((c: any) => c.id === command.id),
      );

      expect(withCommand.state.commands[0].type).to.equal("interface-restart");

      agent.send({ type: "command.ack", id: command.id });
      agent.send({ type: "command.complete", id: command.id, exitCode: 0 });

      // Отчёт и неверное сообщение.
      agent.send({
        type: "report",
        report: {
          appliedVersion: changed.state.version,
          agentVersion: "2.2.0",
        },
      });
      agent.send({ type: "stats", stats: { interfaces: "нет" } });
      expect(
        (await agent.next(message => message.type === "error")).message,
      ).to.be.a("string");

      await eventually(async () => {
        const dto = expectStatus(
          await call(admin, "GET", `/api/v1/wg/nodes/${node.id}`),
          200,
        ).data;

        return dto.agentVersion === "2.2.0" && dto.inSync;
      });

      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`);
    } finally {
      agent.close();
    }
  });

  it("тик статистики подтверждается номером, повтор тоже; живая статистика ноды — с каналом link", async () => {
    const agent = await TestAgent.connect(node.key);

    try {
      agent.send({ type: "hello", knownVersion: -1 });
      await agent.next(message => message.type === "welcome");

      const tick = (seq: number) => {
        const now = Date.now();

        return {
          type: "stats",
          stats: {
            seq,
            bootId: "link-e2e",
            collectedAt: now,
            sentAt: now,
            interfaces: [],
          },
        };
      };

      agent.send(tick(1));
      agent.send(tick(1));
      agent.send(tick(2));

      expect((await agent.next(m => m.type === "ack")).seq).to.equal(1);
      expect((await agent.next(m => m.type === "ack")).seq).to.equal(1);
      expect((await agent.next(m => m.type === "ack")).seq).to.equal(2);

      const live = expectStatus(
        await call(admin, "GET", `/api/v1/wg/stats/current/node/${node.id}`),
        200,
      ).data;

      expect(live.transport).to.equal("link");
    } finally {
      agent.close();
    }
  });

  it("при открытой админке агент получает частую статистику", async () => {
    const agent = await TestAgent.connect(node.key);

    try {
      agent.send({ type: "hello", knownVersion: -1 });

      const welcome = await agent.next(message => message.type === "welcome");

      // Админка открыта (сокет подключён) — частота «живая» сразу или сменой rate.
      if (welcome.statsIntervalMs !== 1000) {
        expect(
          (await agent.next(message => message.type === "rate"))
            .statsIntervalMs,
        ).to.equal(1000);
      }
    } finally {
      agent.close();
    }
  });

  it("разрыв без переподключения — нода offline сразу, без общего порога молчания", async () => {
    const agent = await TestAgent.connect(node.key);

    agent.send({ type: "hello", knownVersion: -1 });
    await agent.next(message => message.type === "welcome");
    expect(await nodeStatus()).to.equal("online");

    const offline = viewer.next<any>(
      "wg:node:updated",
      dto => dto.id === node.id && dto.status === "offline",
      20_000,
    );

    agent.close();

    // Событие несёт ноду целиком, а не сырые колонки UPDATE.
    expect((await offline).name).to.equal("link-node");
    expect(await nodeStatus()).to.equal("offline");
  });

  it("ротация ключа закрывает открытое соединение", async () => {
    const agent = await TestAgent.connect(node.key);

    agent.send({ type: "hello", knownVersion: -1 });
    await agent.next(message => message.type === "welcome");

    const closed = agent.closed();
    const rotated = expectStatus(
      await call(admin, "POST", `/api/v1/wg/nodes/${node.id}/agent-key`),
      201,
    ).data;

    expect(await closed).to.equal(4401);
    node.key = rotated.agentKey;
  });
});
