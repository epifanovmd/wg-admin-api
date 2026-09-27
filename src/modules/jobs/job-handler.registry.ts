import { config } from "../../config";
import {
  IJobHandler,
  Injectable,
  InternalServerErrorException,
  JobDefinition,
} from "../../core";
import { JOB_MAX_EXPIRE_SECONDS } from "./jobs.types";

/** Определение очереди с умолчаниями. */
export type TResolvedJobDefinition = Required<
  Pick<
    JobDefinition,
    | "queue"
    | "retryLimit"
    | "retryDelaySeconds"
    | "retryBackoff"
    | "expireInSeconds"
    | "concurrency"
    | "tracked"
  >
> &
  Pick<JobDefinition, "cron">;

export const resolveDefinition = (
  definition: JobDefinition,
): TResolvedJobDefinition => ({
  queue: definition.queue,
  retryLimit: definition.retryLimit ?? 3,
  retryDelaySeconds: definition.retryDelaySeconds ?? 10,
  retryBackoff: definition.retryBackoff ?? true,
  expireInSeconds: definition.expireInSeconds ?? 900,
  concurrency: definition.concurrency ?? config.jobs.concurrency,
  cron: definition.cron,
  tracked: definition.tracked === true,
});

/**
 * Обработчики очередей по имени. Заполняется бутстрапером из `JOB_HANDLER`,
 * а не инъекцией: обработчики сами зависят от `JobQueue` (ставят задачи),
 * и прямая зависимость очереди от них была бы циклом.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly _handlers = new Map<string, IJobHandler<unknown, unknown>>();

  register(handlers: IJobHandler<unknown, unknown>[]): void {
    for (const handler of handlers) {
      const { queue } = handler.definition;

      if (this._handlers.has(queue)) {
        throw new InternalServerErrorException(
          `Очередь «${queue}» зарегистрирована дважды`,
        );
      }

      const { expireInSeconds } = resolveDefinition(handler.definition);

      // pg-boss отвергает больше суток уже при старте — объясняем сразу.
      if (expireInSeconds > JOB_MAX_EXPIRE_SECONDS) {
        throw new InternalServerErrorException(
          `Очередь «${queue}»: expireInSeconds больше суток (${JOB_MAX_EXPIRE_SECONDS})`,
        );
      }

      this._handlers.set(queue, handler);
    }
  }

  all(): IJobHandler<unknown, unknown>[] {
    return [...this._handlers.values()];
  }

  get(queue: string): IJobHandler<unknown, unknown> | undefined {
    return this._handlers.get(queue);
  }

  /** Очереди, которые выполняет Node-процесс (все зарегистрированные). */
  internal(): IJobHandler<unknown, unknown>[] {
    return this.all();
  }

  definition(queue: string): TResolvedJobDefinition | undefined {
    const handler = this._handlers.get(queue);

    return handler && resolveDefinition(handler.definition);
  }
}
