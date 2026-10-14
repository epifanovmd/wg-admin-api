import { expect } from "chai";
import { randomUUID } from "crypto";
import sinon from "sinon";

import { AgentRecentMetrics } from "./agent-recent-metrics";
import { Agents } from "./agents.service";

const point = (at: number) => ({ at, host: { cpu: { usage: at } } });

describe("свежие метрики агента", () => {
  const recent = new AgentRecentMetrics();
  // Свои агенты у каждого прогона: с Redis точки живут дольше теста.
  const a1 = `a1-${randomUUID()}`;
  const a2 = `a2-${randomUUID()}`;

  afterEach(async () => {
    sinon.restore();
    await recent.delete(a1);
    await recent.delete(a2);
  });

  it("окно: точки за последние минуты, старые отбрасываются, по агентам отдельно", async () => {
    const now = Date.now();

    await recent.add(a1, [
      point(now - recent.windowMs - 1000),
      point(now - 2000),
    ]);
    await recent.add(a1, [point(now - 1000)]);
    await recent.add(a2, [point(now)]);

    expect((await recent.range(a1, 0, now)).map(p => p.at)).to.deep.equal([
      now - 2000,
      now - 1000,
    ]);
    expect(await recent.range(a1, now - 1500, now)).to.have.length(1);
    await recent.delete(a1);
    expect(await recent.range(a1, 0, now)).to.deep.equal([]);
    expect(await recent.range(a2, 0, now)).to.have.length(1);
  });

  it("выдача метрик: история из БД и свежие точки без повторов по времени, последние limit", async () => {
    const now = Date.now();
    const metrics = {
      findRange: sinon.stub().resolves([
        { agentId: a1, at: now - 60_000 },
        { agentId: a1, at: now - 3000 },
      ]),
      create: (v: object) => v,
    };
    const agents = new Agents(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      metrics as any,
      recent,
      {} as any,
      {} as any,
    );

    await recent.add(a1, [
      point(now - 3000),
      point(now - 2000),
      point(now - 1000),
    ]);

    expect(
      (await agents.metrics(a1, now - 120_000, now, 100)).map(m => m.at),
    ).to.deep.equal([now - 60_000, now - 3000, now - 2000, now - 1000]);
    expect(
      (await agents.metrics(a1, now - 120_000, now, 2)).map(m => m.at),
    ).to.deep.equal([now - 2000, now - 1000]);
  });
});
