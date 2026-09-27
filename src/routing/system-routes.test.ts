import KoaRouter from "@koa/router";
import { expect } from "chai";
import type { Server } from "http";
import Koa from "koa";
import type { AddressInfo } from "net";

import { config } from "../config";
import type { IHealthIndicator } from "../core";
import { errorMiddleware } from "../middleware/error.middleware";
import { RegisterSystemRoutes, SystemRoutesDeps } from "./system-routes";

/** Тело ответа для проверок. */
const json = (res: Response): Promise<any> => res.json();

const start = async (deps: Partial<SystemRoutesDeps> = {}) => {
  const app = new Koa();
  const router = new KoaRouter();

  RegisterSystemRoutes(router, {
    isReady: () => true,
    dbHealth: { probe: async () => true },
    redis: () => undefined,
    healthIndicators: () => [],
    smtpConfigured: () => false,
    metrics: { enabled: true, token: "" },
    ...deps,
  });
  app.use(errorMiddleware).use(router.routes());

  const server = app.listen(0);

  await new Promise(resolve => server.once("listening", resolve));

  return {
    server,
    get: (path: string, init?: RequestInit) =>
      fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
        init,
      ),
  };
};

describe("RegisterSystemRoutes", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const setup = async (deps: Partial<SystemRoutesDeps> = {}) => {
    const started = await start(deps);

    server = started.server;

    return started.get;
  };

  describe("/ready", () => {
    let role: typeof config.app.role;

    beforeEach(() => {
      role = config.app.role;
    });

    afterEach(() => {
      config.app.role = role;
    });

    it("воркер готов, когда бутстраперы завершены и БД жива", async () => {
      config.app.role = "worker";
      const get = await setup({ isReady: () => true });
      const res = await get("/ready");

      expect(res.status).to.equal(200);
      expect(await json(res)).to.deep.equal({
        status: "ready",
        role: "worker",
      });
    });

    it("503, пока приложение не готово", async () => {
      config.app.role = "worker";
      const get = await setup({ isReady: () => false });

      expect((await get("/ready")).status).to.equal(503);
    });
  });

  describe("/health", () => {
    it("200: БД жива, Redis и SMTP не настроены — не ошибка", async () => {
      const get = await setup();
      const res = await get("/health");
      const body = await json(res);

      expect(res.status).to.equal(200);
      expect(body.status).to.equal("ok");
      expect(body.services).to.deep.equal({
        database: "ok",
        redis: "not_configured",
        smtp: "not_configured",
      });
    });

    it("SMTP — только факт настройки", async () => {
      const get = await setup({ smtpConfigured: () => true });
      const body = await json(await get("/health"));

      expect(body.services.smtp).to.equal("ok");
    });

    it("503 при недоступной БД", async () => {
      const get = await setup({ dbHealth: { probe: async () => false } });
      const res = await get("/health");

      expect(res.status).to.equal(503);
      expect((await json(res)).services.database).to.equal("error");
    });

    it("Redis: PING ok → ok, ошибка → 503", async () => {
      let get = await setup({ redis: () => ({ ping: async () => "PONG" }) });

      expect((await json(await get("/health"))).services.redis).to.equal("ok");
      server?.close();

      get = await setup({
        redis: () => ({ ping: () => Promise.reject(new Error("down")) }),
      });
      const res = await get("/health");

      expect(res.status).to.equal(503);
      expect((await json(res)).services.redis).to.equal("error");
    });

    it("проверки модулей: критичная валит, некритичная — нет", async () => {
      const queue: IHealthIndicator = {
        name: "jobs",
        check: async () => false,
      };
      const optional: IHealthIndicator = {
        name: "push",
        critical: false,
        check: async () => false,
      };

      let get = await setup({ healthIndicators: () => [optional] });
      let res = await get("/health");

      expect(res.status).to.equal(200);
      expect((await json(res)).services.push).to.equal("error");
      server?.close();

      get = await setup({ healthIndicators: () => [queue, optional] });
      res = await get("/health");
      expect(res.status).to.equal(503);
      expect((await json(res)).services.jobs).to.equal("error");
    });
  });

  describe("/metrics", () => {
    it("без токена — открыт, формат Prometheus", async () => {
      const get = await setup();
      const res = await get("/metrics");

      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("text/plain");
      expect(await res.text()).to.contain("http_request_duration_seconds");
    });

    it("с токеном — только с верным Bearer", async () => {
      const get = await setup({ metrics: { enabled: true, token: "s3cret" } });

      expect((await get("/metrics")).status).to.equal(401);
      expect(
        (await get("/metrics", { headers: { Authorization: "Bearer nope" } }))
          .status,
      ).to.equal(401);
      expect(
        (await get("/metrics", { headers: { Authorization: "Bearer s3cret" } }))
          .status,
      ).to.equal(200);
    });

    it("выключены — маршрута нет", async () => {
      const get = await setup({ metrics: { enabled: false, token: "" } });

      expect((await get("/metrics")).status).to.equal(404);
    });
  });
});
