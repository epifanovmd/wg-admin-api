import { randomBytes } from "crypto";
import WebSocket from "ws";

import { BASE_URL } from "./harness";

/**
 * Фейковый агент ноды для сценариев домена: говорит с сервером по формату
 * agent-sdk (регистрация, WebSocket, hello, status, metrics, события,
 * ответы на настройки, запросы и действия), а вместо воркеров wg и socks —
 * их ответы. Настоящий агент с воркером — `real-agent.ts`.
 */

interface IEnvelope {
  type: string;
  id?: string;
  re?: string;
  seq?: number;
  data?: any;
}

/** Ответ воркера на запрос (`fetch`). */
export interface IFakeFetchResponse {
  status: number;
  body?: unknown;
}

export interface IFakeAgentOptions {
  name?: string;
  labels?: Record<string, string>;
  /** Итог применения `wg/state`; по умолчанию — все включённые интерфейсы up. */
  stateResult?: (state: any) => unknown;
}

const WG_MANIFEST = {
  version: "1.0.0",
  configs: [{ key: "state" }, { key: "probes" }],
  routes: [
    { method: "POST", path: "/interfaces/{name}/restart" },
    { method: "GET", path: "/state" },
  ],
  events: [{ type: "state.result" }, { type: "route.changed" }],
};

const SOCKS_MANIFEST = { version: "1.0.0", configs: [{ key: "proxies" }] };

const newId = (): string => randomBytes(16).toString("hex");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Итог по умолчанию: включённые интерфейсы подняты, ошибок нет. */
export const defaultStateResult = (state: any) => ({
  version: state.version,
  appliedAt: Date.now(),
  interfaces: (state.interfaces ?? []).map((iface: any) => ({
    name: iface.name,
    status: iface.enabled ? "up" : "down",
  })),
  routes: [],
  errors: [],
});

export class FakeNodeAgent {
  /** Последние значения настроек: `воркер/ключ` → `{ version, data }`. */
  readonly configs = new Map<string, { version: number; data: any }>();
  /** Запросы к воркерам: `воркер METHOD path`. */
  readonly fetches: Array<{ worker: string; method: string; path: string }> =
    [];
  /** Встроенные действия: имя и аргументы. */
  readonly actions: Array<{ name: string; args?: any }> = [];
  /** Последний `watch` сервера. */
  watch: any = null;
  stateResult: (state: any) => unknown;
  /** Ответ на запрос к воркеру; по умолчанию — перезапуск интерфейса. */
  onFetch: (
    worker: string,
    method: string,
    path: string,
  ) => IFakeFetchResponse = (_worker, _method, path) => {
    const name = /^\/interfaces\/([^/]+)\/restart$/.exec(path)?.[1];

    return name
      ? { status: 200, body: { name: decodeURIComponent(name), status: "up" } }
      : { status: 404, body: { message: "нет маршрута" } };
  };

  private _ws: WebSocket | null = null;
  private _seq = 0;
  private _waiters: Array<() => void> = [];
  private readonly _acks = new Map<string, () => void>();
  private _lastPut = 0;

  private constructor(
    readonly agentId: string,
    private readonly _secret: string,
    readonly name: string,
    private readonly _labels: Record<string, string>,
    options: IFakeAgentOptions,
  ) {
    this.stateResult = options.stateResult ?? defaultStateResult;
  }

  /** Зарегистрироваться по токену и подключиться. */
  static async start(
    token: string,
    options: IFakeAgentOptions = {},
  ): Promise<FakeNodeAgent> {
    const name = options.name ?? `fake-${newId().slice(0, 8)}`;
    const labels = options.labels ?? {};
    const res = await fetch(`${BASE_URL}/api/v1/agent-link/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        name,
        labels,
        host: { os: "linux", arch: "amd64", hostname: name },
      }),
    });

    if (res.status !== 200) {
      throw new Error(`enroll: ${res.status} ${await res.text()}`);
    }

    const creds = (await res.json()) as { agentId: string; secret: string };
    const agent = new FakeNodeAgent(
      creds.agentId,
      creds.secret,
      name,
      labels,
      options,
    );

    await agent.connect();

    return agent;
  }

  /** Подключиться заново (после `disconnect`). */
  async connect(): Promise<void> {
    const ws = new WebSocket(
      `${BASE_URL.replace(/^http/, "ws")}/api/v1/agent-link`,
      "agent.v2",
      {
        headers: { authorization: `Agent ${this.agentId}.${this._secret}` },
      },
    );

    this._ws = ws;
    ws.on("message", raw => this._onMessage(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, r) =>
        reject(new Error(`HTTP ${r.statusCode}`)),
      );
    });
    this._seq = 0;
    this._send({
      type: "hello",
      data: {
        agent: { version: "1.0.0", bootId: newId(), startedAt: Date.now() },
        host: { os: "linux", arch: "amd64", hostname: this.name },
        ...(Object.keys(this._labels).length && { labels: this._labels }),
        workers: this._workers(),
        ...(this.configs.size && { configs: this._configVersions() }),
      },
    });
    await this.waitFor(() => this._welcomed, 5000, "welcome");
    this.status();
  }

  /** Закрыть соединение (агент пропал). */
  async disconnect(): Promise<void> {
    const ws = this._ws;

    this._ws = null;
    this._welcomed = false;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      ws.once("close", () => resolve());
      ws.close(1001);
    });
  }

  /** Состояние воркеров (поток `status`). */
  status(
    patch: Partial<Record<"wg" | "socks", Record<string, unknown>>> = {},
  ): void {
    this._stream("status", {
      workers: this._workers(patch),
      outbox: 0,
    });
  }

  /** Точка метрик: воркеры (`wg`, `socks`) и узел (`host`). */
  metrics(point: {
    wg?: unknown;
    socks?: unknown;
    host?: Record<string, unknown>;
    collectedAt?: number;
  }): void {
    this._stream("metrics", {
      collectedAt: point.collectedAt ?? Date.now(),
      ...(point.host && { host: point.host }),
      workers: {
        ...(point.wg !== undefined && { wg: point.wg }),
        ...(point.socks !== undefined && { socks: point.socks }),
      },
    });
  }

  /** Событие воркера (важное): ждёт подтверждения сервера. */
  async event(worker: string, type: string, data: unknown): Promise<void> {
    const id = newId();
    const acked = new Promise<void>(resolve => this._acks.set(id, resolve));

    this._send({
      type: "event",
      id,
      data: { worker, type, data, at: Date.now() },
    });
    await Promise.race([
      acked,
      sleep(5000).then(() => {
        throw new Error(`событие ${type} не подтверждено`);
      }),
    ]);
  }

  /** Значение настройки или `undefined`. */
  config(worker: string, key: string): any {
    return this.configs.get(`${worker}/${key}`)?.data;
  }

  /**
   * Дождаться настройки по условию; затем — пока сервер не перестанет
   * присылать новые версии (сборка настроек ноды закончилась).
   */
  async waitConfig(
    worker: string,
    key: string,
    match: (data: any) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<any> {
    await this.waitFor(
      () => {
        const data = this.config(worker, key);

        return data !== undefined && match(data);
      },
      timeoutMs,
      `${worker}/${key}`,
    );
    await this.settle();

    return this.config(worker, key);
  }

  /** Сервер не присылал настроек `quietMs`. */
  async settle(quietMs = 200): Promise<void> {
    while (Date.now() - this._lastPut < quietMs) await sleep(50);
  }

  async waitFor(
    check: () => boolean,
    timeoutMs = 10_000,
    what = "условие",
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`фейковый агент ${this.name}: не дождались ${what}`);
      }
      await new Promise<void>(resolve => {
        this._waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  private _welcomed = false;

  private _workers(
    patch: Partial<Record<"wg" | "socks", Record<string, unknown>>> = {},
  ) {
    const configs = (worker: string) =>
      Object.fromEntries(
        [...this.configs]
          .filter(([key]) => key.startsWith(`${worker}/`))
          .map(([key, value]) => [
            key.slice(worker.length + 1),
            { version: value.version, ok: true },
          ]),
      );

    return [
      {
        name: "wg",
        state: "running",
        version: "1.0.0",
        release: true,
        restarts: 0,
        health: {
          ok: true,
          info: {
            wgVersion: "wireguard-tools v1.0.0",
            wgMode: "kernel",
            udpPorts: [],
            tcpPorts: [],
          },
        },
        manifest: WG_MANIFEST,
        configs: configs("wg"),
        ...patch.wg,
      },
      {
        name: "socks",
        state: "running",
        version: "1.0.0",
        release: true,
        restarts: 0,
        health: { ok: true },
        manifest: SOCKS_MANIFEST,
        configs: configs("socks"),
        ...patch.socks,
      },
    ];
  }

  private _configVersions() {
    const out: Record<string, Record<string, number>> = {};

    for (const [key, value] of this.configs) {
      const [worker, name] = key.split("/");

      (out[worker] ??= {})[name] = value.version;
    }

    return out;
  }

  private _send(env: IEnvelope): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(env));
    }
  }

  private _stream(type: string, data: unknown): void {
    this._seq += 1;
    this._send({ type, seq: this._seq, data });
  }

  private _onMessage(env: IEnvelope): void {
    switch (env.type) {
      case "welcome":
        this._welcomed = true;
        break;
      case "config.put":
        this._onConfig(env.data);
        break;
      case "config.delete":
        this.configs.delete(`${env.data.worker}/${env.data.key}`);
        this.status();
        break;
      case "fetch":
        this._onFetch(env);
        break;
      case "action":
        this._onAction(env);
        break;
      case "watch":
        this.watch = env.data;
        break;
      case "ack":
        for (const id of env.data?.ids ?? []) {
          this._acks.get(id)?.();
          this._acks.delete(id);
        }
        break;
      default:
    }
    for (const waiter of this._waiters.splice(0)) waiter();
  }

  private _onConfig(data: any): void {
    const key = `${data.worker}/${data.key}`;
    const result =
      data.worker === "wg" && data.key === "state"
        ? this.stateResult(data.data)
        : undefined;

    this.configs.set(key, { version: data.version, data: data.data });
    this._lastPut = Date.now();
    this._send({
      type: "config.applied",
      id: newId(),
      data: {
        worker: data.worker,
        key: data.key,
        version: data.version,
        ok: true,
        ...(result !== undefined && { result }),
      },
    });
    this.status();
  }

  private _onFetch(env: IEnvelope): void {
    const { worker, method, path } = env.data;

    this.fetches.push({ worker, method, path });

    const response = this.onFetch(worker, method, path);

    this._send({
      type: "fetch.head",
      re: env.id,
      data: {
        status: response.status,
        headers: { "content-type": "application/json" },
      },
    });
    if (response.body !== undefined) {
      this._send({
        type: "fetch.chunk",
        re: env.id,
        data: { data: JSON.stringify(response.body), encoding: "utf8" },
      });
    }
    this._send({ type: "fetch.end", re: env.id, data: {} });
  }

  private _onAction(env: IEnvelope): void {
    const { name, args } = env.data;

    this.actions.push({ name, args });

    const result =
      name === "agent.logs"
        ? {
            entries: [
              {
                at: Date.now(),
                level: "info",
                source: args?.worker ?? "agent",
                msg: "журнал фейкового агента",
              },
            ],
          }
        : name === "agent.update" || name === "worker.update"
          ? { version: args?.version ?? "1.0.0", previous: "1.0.0" }
          : undefined;

    this._send({
      type: "action.result",
      id: newId(),
      re: env.id,
      data: { ok: true, ...(result !== undefined && { result }) },
    });
  }
}
