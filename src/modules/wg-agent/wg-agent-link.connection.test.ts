import "reflect-metadata";

import { expect } from "chai";
import { EventEmitter } from "events";
import sinon from "sinon";

import { WgAgentLinkConnection } from "./wg-agent-link.connection";

/** Сокет-заглушка: отправленные сообщения копятся, входящие — `receive`. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: any[] = [];
  readonly ping = sinon.stub();
  readonly terminate = sinon.stub();
  readonly close = sinon.stub();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  receive(message: object): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 80));

describe("WgAgentLinkConnection", () => {
  const nodeId = "11111111-1111-4111-8111-111111111111";
  let socket: FakeSocket;
  let state: { buildCurrent: sinon.SinonStub };
  let session: { stats: sinon.SinonStub; report: sinon.SinonStub };
  let link: WgAgentLinkConnection;
  let desired: { version: number; commands: { id: string }[] };

  beforeEach(() => {
    socket = new FakeSocket();
    desired = { version: 3, commands: [] };
    state = { buildCurrent: sinon.stub().callsFake(async () => desired) };
    session = {
      stats: sinon.stub().resolves({ duplicate: false, backfill: false }),
      report: sinon.stub().resolves(),
    };
    link = new WgAgentLinkConnection(
      socket as any,
      { node: { id: nodeId, configVersion: 1 } as any, keyId: "k" },
      "raw.key",
      "198.51.100.1",
      {
        session: session as any,
        state: state as any,
        commands: {} as any,
        nodes: { touchAgent: sinon.stub().resolves() } as any,
      },
      10_000,
    );
  });

  afterEach(() => link.dispose());

  const types = () => socket.sent.map(message => message.type);

  it("hello: welcome и состояние, если версия агента устарела", async () => {
    socket.receive({ type: "hello", knownVersion: 2 });
    await flush();

    expect(types()).to.deep.equal(["welcome", "state"]);
    expect(socket.sent[0].statsIntervalMs).to.equal(10_000);
  });

  it("hello с актуальной версией без команд — только welcome", async () => {
    socket.receive({ type: "hello", knownVersion: 3 });
    await flush();

    expect(types()).to.deep.equal(["welcome"]);
  });

  it("сигнал без изменений состояние не шлёт; новая команда — шлёт один раз", async () => {
    socket.receive({ type: "hello", knownVersion: 3 });
    await flush();

    link.notifyChanged();
    await flush();
    expect(types()).to.deep.equal(["welcome"]);

    desired = {
      version: 3,
      commands: [{ id: "22222222-2222-4222-8222-222222222222" }],
    };
    link.notifyChanged();
    link.notifyChanged();
    await flush();
    link.notifyChanged();
    await flush();

    expect(types()).to.deep.equal(["welcome", "state"]);
  });

  it("тик с номером подтверждается; частота меняется сообщением rate", async () => {
    socket.receive({ type: "hello", knownVersion: 3 });
    socket.receive({ type: "stats", stats: { seq: 7, interfaces: [] } });
    await flush();

    expect(socket.sent.at(-1)).to.deep.equal({ type: "ack", seq: 7 });

    link.setStatsInterval(1000);
    link.setStatsInterval(1000);
    expect(socket.sent.filter(m => m.type === "rate")).to.deep.equal([
      { type: "rate", statsIntervalMs: 1000 },
    ]);
  });

  it("без pong между проверками соединение закрывается", () => {
    link.heartbeat();
    expect(socket.ping.calledOnce).to.equal(true);

    socket.emit("pong");
    link.heartbeat();
    expect(socket.terminate.called).to.equal(false);

    link.heartbeat();
    expect(socket.terminate.calledOnce).to.equal(true);
  });
});
