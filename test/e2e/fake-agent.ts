import { randomBytes } from "crypto";

import { BASE_URL } from "./harness";

/**
 * Фейковый агент ноды для сценариев домена: говорит с сервером по протоколу
 * агента (`/agent/v1`: регистрация, hello, поток SSE с желаемым и командами,
 * итоги, события, состояние, метрики), а вместо воркеров wg и socks — их
 * ответы. Настоящий агент с воркерами — `agent.ts`.
 */

/** Адрес протокола агента (сервер стенда известен после запуска). */
const api = (): string => `${BASE_URL}/agent/v1`;

/** Ответ воркера на команду (`worker.command`). */
export interface IFakeCommandResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface IFakeAgentOptions {
  name?: string;
  labels?: Record<string, string>;
  /** Итог применения `wg/state`; по умолчанию — все включённые интерфейсы up. */
  stateResult?: (state: any) => unknown;
}

const WG_MANIFEST = {
  configs: [{ key: "state" }, { key: "probes" }],
  commands: [{ type: "interface.restart" }],
  events: [
    { type: "state.result" },
    { type: "route.changed" },
    { type: "node.info" },
  ],
};

const SOCKS_MANIFEST = { configs: [{ key: "proxies" }] };

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
  /** Команды воркерам: воркер, тип, аргументы. */
  readonly workerCommands: Array<{ worker: string; type: string; args?: any }> =
    [];
  /** Команды агенту (кроме `worker.command`): тип и аргументы. */
  readonly commands: Array<{ type: string; args?: any }> = [];
  /** Последнее наблюдение сервера (`watch` желаемого). */
  watch: any = null;
  stateResult: (state: any) => unknown;
  /** Ответ воркера на команду; по умолчанию — перезапуск интерфейса. */
  onCommand: (worker: string, type: string, args: any) => IFakeCommandResult = (
    _worker,
    type,
    args,
  ) =>
    type === "interface.restart"
      ? { ok: true, result: { name: args?.name, status: "up" } }
      : {
          ok: false,
          error: { code: "COMMAND_UNDECLARED", message: `нет команды ${type}` },
        };

  private _stream: AbortController | null = null;
  private _after = 0;
  private _rev = 0;
  private _waiters: Array<() => void> = [];
  private _lastPut = 0;
  private _health: Partial<Record<"wg" | "socks", Record<string, unknown>>> =
    {};

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
    const res = await fetch(`${api()}/enroll`, {
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

  /** hello и поток (после `disconnect` — заново). */
  async connect(): Promise<void> {
    await this._post("/hello", {
      agent: {
        version: "1.0.0",
        bootId: newId(),
        startedAt: Date.now(),
        updateMode: "self",
        install: "systemd",
      },
      host: { os: "linux", arch: "amd64", hostname: this.name },
      name: this.name,
      labels: this._labels,
      workers: [
        { name: "wg", version: "2.0.0", release: true, manifest: WG_MANIFEST },
        {
          name: "socks",
          version: "2.0.0",
          release: true,
          manifest: SOCKS_MANIFEST,
        },
      ],
    });

    const controller = new AbortController();
    const res = await fetch(`${api()}/stream?after=${this._after}`, {
      headers: this._auth(),
      signal: controller.signal,
    });

    if (res.status !== 200 || !res.body) {
      throw new Error(`stream: ${res.status} ${await res.text()}`);
    }
    this._stream = controller;
    void this._read(res.body).catch(() => undefined);
    await this.waitFor(() => this._rev > 0, 5000, "желаемое");
    await this.state();
  }

  /** Закрыть поток (агент пропал). */
  async disconnect(): Promise<void> {
    this._stream?.abort();
    this._stream = null;
  }

  /** Состояние воркеров; `patch` — поля воркера (пульс и т. п.). */
  async state(
    patch: Partial<Record<"wg" | "socks", Record<string, unknown>>> = {},
  ): Promise<void> {
    for (const [worker, value] of Object.entries(patch)) {
      this._health[worker as "wg" | "socks"] = value;
    }
    await this._post("/state", {
      desiredRev: this._rev,
      outbox: 0,
      workers: (["wg", "socks"] as const).map(worker => ({
        name: worker,
        state: "running",
        version: "2.0.0",
        release: true,
        restarts: 0,
        health: { ok: true },
        configs: this._applied(worker),
        ...this._health[worker],
      })),
    });
  }

  /** Точка метрик: воркеры (`wg`, `socks`) и узел (`host`). */
  async metrics(point: {
    wg?: unknown;
    socks?: unknown;
    host?: Record<string, unknown>;
    at?: number;
  }): Promise<void> {
    await this._post("/metrics", [
      {
        at: point.at ?? Date.now(),
        ...(point.host && { host: point.host }),
        workers: {
          ...(point.wg !== undefined && { wg: point.wg }),
          ...(point.socks !== undefined && { socks: point.socks }),
        },
      },
    ]);
  }

  /** Событие воркера: сервер принимает его в ответе. */
  async event(worker: string, type: string, data: unknown): Promise<void> {
    const id = newId();
    const reply = (await this._post("/events", [
      { id, worker, type, data, at: Date.now() },
    ])) as { accepted?: string[]; rejected?: unknown[] };

    if (!reply.accepted?.includes(id)) {
      throw new Error(
        `событие ${type} не принято: ${JSON.stringify(reply.rejected)}`,
      );
    }
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

  private _auth(): Record<string, string> {
    return { authorization: `Agent ${this.agentId}.${this._secret}` };
  }

  private async _post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${api()}${path}`, {
      method: "POST",
      headers: { ...this._auth(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (res.status >= 300) {
      throw new Error(`POST ${path}: ${res.status} ${text}`);
    }

    return text ? JSON.parse(text) : {};
  }

  private _applied(worker: string) {
    return Object.fromEntries(
      [...this.configs]
        .filter(([key]) => key.startsWith(`${worker}/`))
        .map(([key, value]) => [
          key.slice(worker.length + 1),
          { version: value.version, ok: true },
        ]),
    );
  }

  /** Поток SSE: события `desired` и `command`. */
  private async _read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      let end: number;

      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);

        buffer = buffer.slice(end + 2);

        let type = "";
        const data: string[] = [];

        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (type && data.length) {
          await this._onEvent(type, JSON.parse(data.join("\n"))).catch(
            () => undefined,
          );
        }
        for (const waiter of this._waiters.splice(0)) waiter();
      }
    }
  }

  private async _onEvent(type: string, data: any): Promise<void> {
    if (type === "desired") await this._onDesired(data);
    else if (type === "command") await this._onCommand(data);
  }

  /** Желаемое целиком: изменившиеся ключи — «применить», итог `wg/state` — событием. */
  private async _onDesired(desired: any): Promise<void> {
    this.watch = desired.watch ?? null;

    const seen = new Set<string>();
    let changed = false;

    for (const [worker, part] of Object.entries<any>(desired.workers ?? {})) {
      for (const [key, value] of Object.entries<any>(part.configs ?? {})) {
        const id = `${worker}/${key}`;

        seen.add(id);
        if (this.configs.get(id)?.version === value.version) continue;
        this.configs.set(id, { version: value.version, data: value.data });
        this._lastPut = Date.now();
        changed = true;
        if (id === "wg/state") {
          await this.event("wg", "state.result", this.stateResult(value.data));
        }
      }
    }
    for (const id of [...this.configs.keys()]) {
      if (!seen.has(id)) {
        this.configs.delete(id);
        changed = true;
      }
    }
    this._rev = desired.rev ?? this._rev;
    if (changed) await this.state();
  }

  private async _onCommand(command: any): Promise<void> {
    this._after = Math.max(this._after, command.seq ?? 0);

    let reply: IFakeCommandResult;

    if (command.type === "worker.command") {
      const { worker, type, args } = command.args ?? {};

      this.workerCommands.push({ worker, type, args });
      reply = this.onCommand(worker, type, args);
    } else {
      this.commands.push({ type: command.type, args: command.args });
      reply = { ok: true, result: this._agentResult(command) };
    }
    await this._post("/results", [{ re: command.id, ...reply }]);
  }

  private _agentResult(command: any): unknown {
    switch (command.type) {
      case "agent.logs":
        return {
          entries: [
            {
              at: Date.now(),
              level: "info",
              source: command.args?.worker ?? "agent",
              msg: "журнал фейкового агента",
            },
          ],
        };
      case "agent.update":
      case "worker.update":
        return { version: command.args?.version ?? "2.0.0", previous: "2.0.0" };
      default:
        return {};
    }
  }
}
