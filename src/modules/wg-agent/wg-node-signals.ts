import { inject } from "inversify";
import { DataSource } from "typeorm";

import { IBootstrap, Injectable, PgSignals } from "../../core";

/** Канал NOTIFY триггеров `wg_nodes.config_version` и `wg_node_commands`. */
export const WG_NODE_CHANGED_CHANNEL = "wg_node_changed";

/**
 * Изменения нод для long-poll агентов: триггер БД шлёт id ноды после коммита
 * при смене версии конфигурации и появлении команды.
 */
@Injectable()
export class WgNodeSignals extends PgSignals<typeof WG_NODE_CHANGED_CHANNEL> {
  constructor(@inject(DataSource) dataSource: DataSource) {
    super(dataSource, [WG_NODE_CHANGED_CHANNEL], "wg-node-signals");
  }

  /** Дождаться сигнала по ноде или таймаута. */
  waitForNode(nodeId: string, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const done = (): void => {
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      const off = this.on(WG_NODE_CHANGED_CHANNEL, payload => {
        if (payload === nodeId) done();
      });
    });
  }
}

/** Запуск LISTEN при старте процесса. */
@Injectable()
export class WgNodeSignalsBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(WgNodeSignals) private readonly _signals: WgNodeSignals,
  ) {}

  initialize(): Promise<void> {
    return this._signals.start();
  }

  destroy(): Promise<void> {
    return this._signals.stop();
  }
}
