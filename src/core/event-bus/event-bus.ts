import { Injectable } from "../decorators";
import { logger } from "../logger";

type Constructor<T> = new (...args: any[]) => T;
type Handler<T> = (event: T) => void | Promise<void>;

@Injectable()
export class EventBus {
  // Используем Constructor как ключ — безопасно при минификации, строковые имена не нужны

  private readonly handlers = new Map<Constructor<any>, Set<Handler<any>>>();

  emit<T extends object>(event: T): void {
    const ctor = event.constructor as Constructor<T>;
    const handlers = this.handlers.get(ctor);

    if (!handlers) return;

    for (const handler of handlers) {
      try {
        const result = handler(event);

        if (result instanceof Promise) {
          result.catch(err =>
            logger.error(
              { err },
              `[EventBus] Handler error for "${ctor.name}"`,
            ),
          );
        }
      } catch (err) {
        logger.error({ err }, `[EventBus] Handler error for "${ctor.name}"`);
      }
    }
  }

  async emitAsync<T extends object>(event: T): Promise<void> {
    const ctor = event.constructor as Constructor<T>;
    const handlers = this.handlers.get(ctor);

    if (!handlers) return;

    const results = await Promise.allSettled(
      [...handlers].map(handler => handler(event)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        logger.error(
          { err: result.reason },
          `[EventBus] Async handler error for "${ctor.name}"`,
        );
      }
    }
  }

  on<T extends object>(
    EventClass: Constructor<T>,
    handler: Handler<T>,
  ): () => void {
    if (!this.handlers.has(EventClass)) {
      this.handlers.set(EventClass, new Set());
    }

    this.handlers.get(EventClass)!.add(handler);

    return () => this.off(EventClass, handler);
  }

  once<T extends object>(
    EventClass: Constructor<T>,
    handler: Handler<T>,
  ): () => void {
    const wrapper: Handler<T> = event => {
      off();

      return handler(event);
    };

    const off = this.on(EventClass, wrapper);

    return off;
  }

  off<T extends object>(EventClass: Constructor<T>, handler: Handler<T>): void {
    this.handlers.get(EventClass)?.delete(handler);
  }

  /** Снимает все подписки. Вызывать при завершении приложения. */
  clear(): void {
    this.handlers.clear();
  }
}
