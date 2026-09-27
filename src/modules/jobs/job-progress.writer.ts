import { logger } from "../../core";
import { JOB_PROGRESS_THROTTLE_MS } from "./jobs.types";

export type TProgressFlush = (
  value: number | undefined,
  text: string | undefined,
  lines: string[],
) => Promise<unknown>;

/**
 * Троттлинг `ctx.progress` и `ctx.log`: не больше одной записи в интервал,
 * промежуточные значения схлопываются, последнее не теряется. Записи идут
 * строго друг за другом.
 */
export class JobProgressWriter {
  private _value: number | undefined;
  private _text: string | undefined;
  private _lines: string[] = [];
  private _lastWriteAt = 0;
  private _timer: NodeJS.Timeout | null = null;
  private _chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly _write: TProgressFlush,
    private readonly _intervalMs = JOB_PROGRESS_THROTTLE_MS,
  ) {}

  progress(value: number, text?: string): Promise<void> {
    this._value = value;
    if (text !== undefined) this._text = text;

    return this.schedule();
  }

  log(line: string): Promise<void> {
    this._lines.push(line);

    return this.schedule();
  }

  /** Записать накопленное сейчас и дождаться всех записей. */
  flush(): Promise<void> {
    this.clearTimer();

    const value = this._value;
    const text = this._text;
    const lines = this._lines;

    if (value !== undefined || text !== undefined || lines.length > 0) {
      this._value = undefined;
      this._text = undefined;
      this._lines = [];
      this._lastWriteAt = Date.now();
      // Сбой прошлой записи не блокирует следующие.
      this._chain = this._chain
        .catch(() => undefined)
        .then(async () => {
          await this._write(value, text, lines);
        });
    }

    return this._chain;
  }

  dispose(): void {
    this.clearTimer();
  }

  private schedule(): Promise<void> {
    const wait = this._lastWriteAt + this._intervalMs - Date.now();

    if (wait <= 0 && !this._timer) return this.flush();

    this._timer ??= setTimeout(
      () => {
        this._timer = null;
        this.flush().catch(err =>
          logger.warn({ err }, "[Jobs] Не удалось записать прогресс"),
        );
      },
      Math.max(wait, 0),
    );
    this._timer.unref();

    return Promise.resolve();
  }

  private clearTimer(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }
}
