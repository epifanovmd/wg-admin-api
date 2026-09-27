import { expect } from "chai";
import { once } from "events";
import { createServer, Server } from "http";
import Koa from "koa";
import { AddressInfo } from "net";

import { helmetMiddleware } from "./helmet.middleware";

/** Настоящий Koa на свободном порту: заголовки проверяются как у клиента. */
const startApp = async (): Promise<{ server: Server; url: string }> => {
  const app = new Koa();

  app.use(helmetMiddleware);
  app.use(ctx => {
    ctx.body = { ok: true };
  });

  const server = createServer(app.callback()).listen(0);

  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  return { server, url: `http://127.0.0.1:${port}` };
};

describe("helmetMiddleware", () => {
  let server: Server;
  let url: string;

  before(async () => {
    ({ server, url } = await startApp());
  });

  after(() => {
    server.close();
  });

  it("API: строгая CSP, запрет фреймов и nosniff", async () => {
    const res = await fetch(`${url}/api/users`);
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).to.include("default-src 'none'");
    expect(csp).to.include("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).to.equal("nosniff");
  });

  it("файлы API можно встраивать с другого origin (<img> фронтенда)", async () => {
    const res = await fetch(`${url}/api/file/1`);

    expect(res.headers.get("cross-origin-resource-policy")).to.equal(
      "cross-origin",
    );
  });

  it("Swagger UI: разрешены скрипты и стили cdnjs и inline-инициализация", async () => {
    const res = await fetch(`${url}/api-docs`);
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).to.include("https://cdnjs.cloudflare.com");
    expect(csp).to.match(/script-src[^;]*'unsafe-inline'/);
  });

  it("Swagger UI по http: спецификация и «Try it out» не переводятся на https", async () => {
    const res = await fetch(`${url}/api-docs`);
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).not.to.include("upgrade-insecure-requests");
  });
});
