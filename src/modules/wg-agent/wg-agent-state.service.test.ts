import "reflect-metadata";

import { expect } from "chai";
import { EventEmitter } from "events";
import sinon from "sinon";

import { uuid } from "../../test/helpers";
import { WgAgentStateService } from "./wg-agent-state.service";

/** Сигналы нод: `emit(nodeId)` — как NOTIFY от триггера после коммита. */
class FakeSignals extends EventEmitter {
  isListening = true;

  waitForNode(nodeId: string, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const done = (): void => {
        clearTimeout(timer);
        this.off(nodeId, done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);

      this.on(nodeId, done);
    });
  }
}

describe("WgAgentStateService.waitAndBuild", () => {
  it("отвечает сразу по сигналу изменения, не дожидаясь тика опроса", async () => {
    // Ожидание не опрашивает БД по таймеру: ответ — по сигналу изменения.
    const node = { id: uuid(), configVersion: 3 } as any;
    const nodes = {
      findOne: sinon.stub().resolves({ id: node.id, configVersion: 3 }),
    };
    const commands = { pendingForAgent: sinon.stub().resolves([]) };
    const signals = new FakeSignals();
    const service = new WgAgentStateService(
      nodes as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      commands as any,
      signals as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const build = sinon
      .stub(service as any, "_build")
      .callsFake(async (_n: unknown, version: unknown) => ({ version }));

    const started = Date.now();
    const pending = service.waitAndBuild(node, 3, 20_000);

    setTimeout(() => {
      nodes.findOne.resolves({ id: node.id, configVersion: 4 });
      signals.emit(node.id);
    }, 50);

    const result = (await pending) as unknown as { version: number };

    expect(result.version).to.equal(4);
    expect(Date.now() - started).to.be.lessThan(400);
    expect(build.calledOnce).to.be.true;
  });
});
