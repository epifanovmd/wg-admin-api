import { expect } from "chai";
import sinon from "sinon";

import { JobProgressWriter } from "./job-progress.writer";

describe("JobProgressWriter", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 10_000 });
  });

  afterEach(() => clock.restore());

  it("первая запись — сразу, частые — схлопываются в одну за интервал", async () => {
    const write = sinon.stub().resolves();
    const writer = new JobProgressWriter(write, 500);

    await writer.progress(0.1, "a");
    expect(write.callCount).to.equal(1);

    await writer.progress(0.2);
    await writer.progress(0.3, "c");
    await writer.log("line 1");
    expect(write.callCount).to.equal(1);

    await clock.tickAsync(500);
    expect(write.callCount).to.equal(2);
    expect(write.secondCall.args).to.deep.equal([0.3, "c", ["line 1"]]);
  });

  it("flush пишет накопленное сразу, пустой flush ничего не пишет", async () => {
    const write = sinon.stub().resolves();
    const writer = new JobProgressWriter(write, 500);

    await writer.progress(0.1);
    await writer.log("x");
    await writer.flush();
    expect(write.callCount).to.equal(2);

    await writer.flush();
    expect(write.callCount).to.equal(2);
  });

  it("не больше двух записей в секунду", async () => {
    const write = sinon.stub().resolves();
    const writer = new JobProgressWriter(write, 500);

    for (let i = 0; i < 100; i += 1) {
      await writer.progress(i / 100);
      await clock.tickAsync(10);
    }

    // 1000 мс вызовов → не больше 3 записей (сразу + по одной на интервал).
    expect(write.callCount).to.be.at.most(3);
  });

  it("сбой записи не блокирует следующие", async () => {
    const write = sinon.stub();

    write.onFirstCall().rejects(new Error("db"));
    write.resolves();

    const writer = new JobProgressWriter(write, 0);

    await writer.progress(0.1).catch(() => undefined);
    await writer.progress(0.2);
    expect(write.callCount).to.equal(2);
  });
});
