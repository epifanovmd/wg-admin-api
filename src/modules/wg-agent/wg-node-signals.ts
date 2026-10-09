import { inject } from "inversify";
import { DataSource } from "typeorm";

import { Injectable, PgSignals } from "../../core";

/** Канал NOTIFY триггера `wg_nodes.config_version`. */
export const WG_NODE_CHANGED_CHANNEL = "wg_node_changed";

/**
 * Изменения нод: триггер БД шлёт id ноды после коммита при смене версии
 * конфигурации — по нему настройки воркеров ноды пересобираются.
 */
@Injectable()
export class WgNodeSignals extends PgSignals<typeof WG_NODE_CHANGED_CHANNEL> {
  constructor(@inject(DataSource) dataSource: DataSource) {
    super(dataSource, [WG_NODE_CHANGED_CHANNEL], "wg-node-signals");
  }
}
