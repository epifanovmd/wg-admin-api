import { expect } from "chai";

import { JobHandlerRegistry } from "./job-handler.registry";

const handler = (definition: Record<string, unknown>) =>
  ({ definition, handle: async () => undefined }) as any;

describe("JobHandlerRegistry", () => {
  it("очередь дважды — ошибка регистрации", () => {
    const registry = new JobHandlerRegistry();

    expect(() =>
      registry.register([handler({ queue: "a" }), handler({ queue: "a" })]),
    ).to.throw(/дважды/);
  });

  it("срок выполнения больше суток — понятная ошибка сразу, а не отказ pg-boss при старте", () => {
    expect(() =>
      new JobHandlerRegistry().register([
        handler({ queue: "long", expireInSeconds: 2 * 86_400 }),
      ]),
    ).to.throw(/больше суток/);
  });
});
