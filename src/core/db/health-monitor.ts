import { DataSource } from "typeorm";

import { logger } from "../logger/logger.service";

export interface DbHealthMonitorOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Фоновая проверка БД для readiness: `/ready` читает кэшированный результат
 * и не ходит в базу на каждый запрос. Потеря соединения снимает реплику с
 * трафика, восстановление — возвращает.
 */
export class DbHealthMonitor {
  private _healthy = false;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private readonly _intervalMs: number;
  private readonly _timeoutMs: number;

  constructor(
    private readonly _dataSource: DataSource,
    options: DbHealthMonitorOptions = {},
  ) {
    this._intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get isHealthy(): boolean {
    return this._healthy;
  }

  /** Первая проверка — сразу, дальше по таймеру; таймер не держит процесс. */
  async start(): Promise<void> {
    await this.check();
    this._timer = setInterval(() => void this.check(), this._intervalMs);
    this._timer.unref();
  }

  stop(): void {
    clearInterval(this._timer);
    this._timer = undefined;
    this._healthy = false;
  }

  /** `SELECT 1` с таймаутом: зависший пул не должен вешать проверку. */
  async check(): Promise<boolean> {
    const was = this._healthy;

    this._healthy = await this.probe();

    if (was !== this._healthy) {
      if (this._healthy) logger.info("Database is reachable");
      else logger.error("Database is unreachable");
    }

    return this._healthy;
  }

  async probe(): Promise<boolean> {
    if (!this._dataSource.isInitialized) return false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), this._timeoutMs);
    });

    try {
      return await Promise.race([
        this._dataSource.query("SELECT 1").then(() => true as const),
        timeout,
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
