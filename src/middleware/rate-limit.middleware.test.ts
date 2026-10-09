import { expect } from "chai";
import { once } from "events";
import { createServer, Server } from "http";
import Koa from "koa";
import { AddressInfo } from "net";

import { createRateLimitMiddleware } from "./rate-limit.middleware";

describe("createRateLimitMiddleware", () => {
  let server: Server;
  let url: string;

  before(async () => {
    const app = new Koa();

    app.use(createRateLimitMiddleware({ limit: 2, intervalMs: 60_000 }));
    app.use(ctx => {
      ctx.body = "ok";
    });
    server = createServer(app.callback()).listen(0);
    await once(server, "listening");
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  it("ошибка ниже по цепочке не глотается и next не вызывается повторно", async () => {
    const app = new Koa();
    let downstreamCalls = 0;

    app.use(createRateLimitMiddleware({ limit: 100, intervalMs: 60_000 }));
    app.use(ctx => {
      downstreamCalls += 1;
      ctx.throw(404, "Not Found");
    });

    const srv = createServer(app.callback()).listen(0);

    await once(srv, "listening");

    const res = await fetch(
      `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    );

    srv.close();
    expect(res.status).to.equal(404);
    expect(downstreamCalls).to.equal(1);
  });

  it("недоступное хранилище не блокирует трафик (fail-open)", async () => {
    const app = new Koa();
    const brokenRedis = new Proxy(
      {},
      { get: () => () => Promise.reject(new Error("redis down")) },
    ) as any;

    app.use(
      createRateLimitMiddleware({
        limit: 1,
        intervalMs: 60_000,
        redis: brokenRedis,
      }),
    );
    app.use(ctx => {
      ctx.body = "ok";
    });

    const srv = createServer(app.callback()).listen(0);

    await once(srv, "listening");

    const res = await fetch(
      `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    );

    srv.close();
    expect(res.status).to.equal(200);
  });

  it("без Redis считает в памяти: сверх лимита — 429 и Retry-After", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      statuses.push((await fetch(url)).status);
    }

    const limited = await fetch(url);

    expect(statuses).to.deep.equal([200, 200, 429]);
    expect(limited.headers.get("retry-after")).to.be.a("string");
  });

  it("skip: пропущенные запросы не расходуют лимит", async () => {
    const app = new Koa();

    app.use(
      createRateLimitMiddleware({
        limit: 1,
        intervalMs: 60_000,
        skip: ctx => ctx.path.startsWith("/free"),
      }),
    );
    app.use(ctx => {
      ctx.body = "ok";
    });

    const srv = createServer(app.callback()).listen(0);

    await once(srv, "listening");

    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const statuses: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      statuses.push((await fetch(`${base}/free/${i}`)).status);
    }
    statuses.push((await fetch(`${base}/api`)).status);
    statuses.push((await fetch(`${base}/api`)).status);

    srv.close();
    expect(statuses).to.deep.equal([200, 200, 200, 200, 429]);
  });
});
