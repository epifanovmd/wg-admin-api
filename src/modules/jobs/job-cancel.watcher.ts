import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { JobRunRepository } from "./job-run.repository";
import { JobSignals } from "./job-signals";
import { JOB_CANCEL_CHANNEL, JOB_CANCEL_POLL_MS } from "./jobs.types";
import { PgBossService } from "./pg-boss.service";

/** Причина `abort()` у сигнала задачи при отмене. */
export const JOB_CANCELLED_REASON = "cancelled";

/**
 * Отмена между процессами: API пишет флаг и шлёт сигнал `job_cancel`, воркер
 * делает `abort()` у сигнала задачи. Без LISTEN — опрос флагов выполняющихся
 * задач раз в 2 с.
 */
@Injectable()
export class JobCancelWatcher {
  private readonly _running = new Map<string, AbortController>();
  private _pollTimer: NodeJS.Timeout | null = null;
  private _unsubscribe: (() => void)[] = [];

  constructor(
    @inject(JobSignals) private readonly _signals: JobSignals,
    @inject(JobRunRepository) private readonly _runs: JobRunRepository,
    @inject(PgBossService) private readonly _boss: PgBossService,
  ) {}

  get isListening(): boolean {
    return this._signals.isListening;
  }

  async start(): Promise<void> {
    this._unsubscribe = [
      this._signals.on(JOB_CANCEL_CHANNEL, id => this.abort(id)),
      this._signals.onStatus(listening => {
        if (!listening) {
          this.startPolling();

          return;
        }

        this.stopPolling();
        // Пока соединения не было, сигналы могли пропустить.
        this.poll().catch(err =>
          logger.warn({ err }, "[Jobs] Опрос отмен не удался"),
        );
      }),
    ];

    await this._signals.start();
    if (!this._signals.isListening) this.startPolling();
  }

  async stop(): Promise<void> {
    this._unsubscribe.forEach(unsubscribe => unsubscribe());
    this._unsubscribe = [];
    this.stopPolling();
  }

  /** Следить за отменой задачи; вернуть функцию снятия. */
  watch(id: string, controller: AbortController): () => void {
    this._running.set(id, controller);

    return () => {
      if (this._running.get(id) === controller) this._running.delete(id);
    };
  }

  /** Сообщить всем процессам об отмене. */
  notify(id: string): Promise<void> {
    return this._signals.notify(JOB_CANCEL_CHANNEL, id);
  }

  /** Отменить локально выполняющуюся задачу. */
  abort(id: string): void {
    const controller = this._running.get(id);

    if (controller && !controller.signal.aborted) {
      logger.info({ jobId: id }, "[Jobs] Отмена выполняющейся задачи");
      controller.abort(JOB_CANCELLED_REASON);
    }
  }

  /** Один проход опроса: флаги в `job_runs` и отмены в pg-boss. */
  async poll(): Promise<void> {
    const ids = [...this._running.keys()];

    if (!ids.length) return;

    const [flagged, cancelled] = await Promise.all([
      this._runs.findCancelRequestedIds(ids),
      this._boss.findCancelledIds(ids),
    ]);

    new Set([...flagged, ...cancelled]).forEach(id => this.abort(id));
  }

  private startPolling(): void {
    if (this._pollTimer) return;

    this._pollTimer = setInterval(() => {
      this.poll().catch(err =>
        logger.warn({ err }, "[Jobs] Опрос отмен не удался"),
      );
    }, JOB_CANCEL_POLL_MS);
    this._pollTimer.unref();
  }

  private stopPolling(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
}
