import KoaRouter from "@koa/router";
import { expect } from "chai";
import { EventEmitter } from "events";
import type { Server } from "http";
import Koa from "koa";
import type { AddressInfo } from "net";

import { errorMiddleware } from "../../middleware/error.middleware";
import { NotFoundException } from "../http";
import { PrometheusJobMetrics } from "./job-metrics";
import {
  httpErrorsTotal,
  httpRequestDuration,
  jobDuration,
  jobsActive,
  jobsTotal,
  socketConnections,
  trackSocketConnection,
} from "./metrics";
import { metricsMiddleware, UNMATCHED_ROUTE } from "./metrics.middleware";

const startServer = async () => {
  const app = new Koa();
  const router = new KoaRouter();

  router.get("/api/v1/items/:id", ctx => {
    if (ctx.params.id === "missing") throw new NotFoundException();
    ctx.body = { id: ctx.params.id };
  });
  router.get("/ping", ctx => {
    ctx.body = "pong";
  });
  app.use(metricsMiddleware).use(errorMiddleware).use(router.routes());

  const server = app.listen(0);

  await new Promise(resolve => server.once("listening", resolve));

  return server;
};

const valueOf = async (
  metric: {
    get(): Promise<{
      values: { labels: object; value: number; metricName?: string }[];
    }>;
  },
  labels: Record<string, string>,
  suffix = "",
) => {
  const { values } = await metric.get();

  return values
    .filter(v => !suffix || v.metricName?.endsWith(suffix))
    .filter(v =>
      Object.entries(labels).every(
        ([k, val]) => (v.labels as Record<string, unknown>)[k] === val,
      ),
    )
    .reduce((sum, v) => sum + v.value, 0);
};

describe("observability metrics", () => {
  describe("metricsMiddleware", () => {
    let server: Server;
    let base: string;

    before(async () => {
      server = await startServer();
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => server.close());

    beforeEach(() => {
      httpRequestDuration.reset();
      httpErrorsTotal.reset();
    });

    it("метка route — шаблон маршрута, а не URL с id", async () => {
      await fetch(`${base}/api/v1/items/123`);
      await fetch(`${base}/api/v1/items/456`);

      expect(
        await valueOf(
          httpRequestDuration,
          { method: "GET", route: "/api/v1/items/:id", status: "200" },
          "_count",
        ),
      ).to.equal(2);
    });

    it("ошибки считаются по коду из тела ответа", async () => {
      await fetch(`${base}/api/v1/items/missing`);

      expect(
        await valueOf(httpErrorsTotal, { code: "NOT_FOUND", status: "404" }),
      ).to.equal(1);
      expect(
        await valueOf(
          httpRequestDuration,
          { route: "/api/v1/items/:id", status: "404" },
          "_count",
        ),
      ).to.equal(1);
    });

    it("запрос без маршрута — метка unmatched", async () => {
      await fetch(`${base}/random/path/42`);

      expect(
        await valueOf(
          httpRequestDuration,
          { route: UNMATCHED_ROUTE, status: "404" },
          "_count",
        ),
      ).to.equal(1);
    });

    it("пробы не попадают в метрики", async () => {
      await fetch(`${base}/ping`);

      expect(await valueOf(httpRequestDuration, {}, "_count")).to.equal(0);
    });
  });

  describe("PrometheusJobMetrics", () => {
    beforeEach(() => {
      jobsActive.reset();
      jobsTotal.reset();
      jobDuration.reset();
    });

    it("считает активные, завершённые и упавшие задачи", async () => {
      const metrics = new PrometheusJobMetrics();

      metrics.onStart("mail.send");
      metrics.onStart("mail.send");
      expect(await valueOf(jobsActive, { queue: "mail.send" })).to.equal(2);

      metrics.onComplete("mail.send", 1500, true);
      metrics.onComplete("mail.send", 200, false);

      expect(await valueOf(jobsActive, { queue: "mail.send" })).to.equal(0);
      expect(
        await valueOf(jobsTotal, { queue: "mail.send", outcome: "completed" }),
      ).to.equal(1);
      expect(
        await valueOf(jobsTotal, { queue: "mail.send", outcome: "failed" }),
      ).to.equal(1);
      expect(
        await valueOf(
          jobDuration,
          { queue: "mail.send", outcome: "completed" },
          "_sum",
        ),
      ).to.equal(1.5);
    });
  });

  describe("trackSocketConnection", () => {
    it("+1 при подключении, −1 на disconnect (один раз)", async () => {
      socketConnections.reset();
      const socket = new EventEmitter();

      trackSocketConnection(socket);
      expect(await valueOf(socketConnections, {})).to.equal(1);

      socket.emit("disconnect");
      socket.emit("disconnect");
      expect(await valueOf(socketConnections, {})).to.equal(0);
    });
  });
});
