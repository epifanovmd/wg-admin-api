import "reflect-metadata";

import { expect } from "chai";
import { EventEmitter } from "events";
import sinon from "sinon";

import { JobSignals } from "./job-signals";
import { JOB_CANCEL_CHANNEL, JOB_SETTLED_CHANNEL } from "./jobs.types";

class FakeClient extends EventEmitter {
  connect = sinon.stub().resolves();
  query = sinon.stub().resolves();
  end = sinon.stub().resolves();
}

class TestSignals extends JobSignals {
  client = new FakeClient();

  protected createClient(): any {
    return this.client;
  }
}

describe("JobSignals", () => {
  let dataSource: { query: sinon.SinonStub };
  let signals: TestSignals;

  beforeEach(() => {
    dataSource = { query: sinon.stub().resolves() };
    signals = new TestSignals(dataSource as any);
  });

  afterEach(() => signals.stop());

  it("одно соединение слушает все каналы задач", async () => {
    await signals.start();

    const listened = signals.client.query.getCalls().map(c => c.args[0]);

    expect(listened).to.deep.equal([
      `LISTEN ${JOB_CANCEL_CHANNEL}`,
      `LISTEN ${JOB_SETTLED_CHANNEL}`,
    ]);
    expect(signals.isListening).to.be.true;
  });

  it("уведомление доходит только до подписчиков своего канала", async () => {
    const settled = sinon.stub();
    const cancel = sinon.stub();

    signals.on(JOB_SETTLED_CHANNEL, settled);
    signals.on(JOB_CANCEL_CHANNEL, cancel);
    await signals.start();

    signals.client.emit("notification", {
      channel: JOB_SETTLED_CHANNEL,
      payload: "job-1",
    });

    expect(settled.calledOnceWith("job-1")).to.be.true;
    expect(cancel.called).to.be.false;
  });

  it("отписка и падение подписчика не мешают остальным", async () => {
    const off = sinon.stub();
    const broken = sinon.stub().throws(new Error("boom"));
    const ok = sinon.stub();

    signals.on(JOB_CANCEL_CHANNEL, off)();
    signals.on(JOB_CANCEL_CHANNEL, broken);
    signals.on(JOB_CANCEL_CHANNEL, ok);
    await signals.start();

    signals.client.emit("notification", {
      channel: JOB_CANCEL_CHANNEL,
      payload: "job-1",
    });

    expect(off.called).to.be.false;
    expect(ok.calledOnceWith("job-1")).to.be.true;
  });

  it("notify — pg_notify; с manager — в его транзакции", async () => {
    const manager = { query: sinon.stub().resolves() };

    await signals.notify(JOB_SETTLED_CHANNEL, "job-1");
    await signals.notify(JOB_SETTLED_CHANNEL, "job-2", manager as any);

    expect(dataSource.query.firstCall.args[1]).to.deep.equal([
      JOB_SETTLED_CHANNEL,
      "job-1",
    ]);
    expect(manager.query.firstCall.args[1]).to.deep.equal([
      JOB_SETTLED_CHANNEL,
      "job-2",
    ]);
  });

  it("LISTEN недоступен или оборвался — подписчики узнают о переходе на опрос", async () => {
    const status = sinon.stub();

    signals.onStatus(status);
    await signals.start();
    signals.client.emit("end");

    expect(status.args.map(a => a[0])).to.deep.equal([true, false]);
    expect(signals.isListening).to.be.false;
  });
});
