import { expect } from "chai";

import { isUuid } from "../common/helpers/uuid";
import { requestIdMiddleware } from "./request-id.middleware";

const createCtx = (incoming?: string) => {
  const headers: Record<string, string> = {};

  return {
    request: { headers: incoming ? { "x-request-id": incoming } : {} },
    state: {} as Record<string, unknown>,
    set: (name: string, value: string) => {
      headers[name] = value;
    },
    headers,
  };
};

describe("requestIdMiddleware", () => {
  it("сохраняет корректный входящий X-Request-ID", async () => {
    const id = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const ctx = createCtx(id);

    await requestIdMiddleware(ctx as never, async () => {});

    expect(ctx.state.requestId).to.equal(id);
    expect(ctx.headers["X-Request-ID"]).to.equal(id);
  });

  it("мусор во входящем заголовке заменяет новым UUID", async () => {
    const ctx = createCtx("<script>");

    await requestIdMiddleware(ctx as never, async () => {});

    expect(isUuid(String(ctx.state.requestId))).to.equal(true);
    expect(ctx.state.requestId).to.not.equal("<script>");
  });
});
