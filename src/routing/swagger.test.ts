import KoaRouter from "@koa/router";
import { expect } from "chai";
import { once } from "events";
import { createServer, request } from "http";
import Koa from "koa";
import { AddressInfo } from "net";

import { RegisterSwagger } from "./swagger";

/** GET с произвольным `Host`: fetch подменять его не даёт. */
const getJson = (port: number, path: string, host: string) =>
  new Promise<any>((resolve, reject) => {
    request({ port, path, headers: { host } }, res => {
      let body = "";

      res.on("data", chunk => (body += chunk));
      res.on("end", () => resolve(JSON.parse(body)));
    })
      .on("error", reject)
      .end();
  });

describe("RegisterSwagger", () => {
  it("передаёт в servers адрес, по которому открыта документация", async () => {
    const app = new Koa();
    const router = new KoaRouter();

    RegisterSwagger(router, "/api-docs", origin => [
      { url: origin, description: "Current" },
    ]);
    app.use(router.routes());

    const server = createServer(app.callback()).listen(0);

    await once(server, "listening");

    try {
      const { port } = server.address() as AddressInfo;
      const spec = await getJson(
        port,
        "/api-docs/swagger.json",
        "0.0.0.0:8181",
      );

      expect(spec.servers).to.deep.equal([
        { url: "http://0.0.0.0:8181", description: "Current" },
      ]);
    } finally {
      server.close();
    }
  });
});
