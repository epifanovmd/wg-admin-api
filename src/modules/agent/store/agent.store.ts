import type {
  AgentRecord,
  ConfigRecord,
  SetConfigOptions,
  Store,
} from "agent-sdk/server";
import { inject } from "inversify";
import { DataSource } from "typeorm";

import {
  Injectable,
  openSecret,
  parseSecretBoxKey,
  sealSecret,
} from "../../../core";
import { agentConfig } from "../agent.config";
import { StoredAgent } from "./stored-agent.entity";
import { StoredAgentConfig } from "./stored-agent-config.entity";

const NUL = String.fromCharCode(0);

/**
 * Копия значения для `jsonb`: Postgres не принимает `\u0000` ни в строках, ни
 * в ключах (ответы и журналы воркеров могут его содержать).
 */
export const jsonSafe = <T>(value: T): T =>
  value === undefined
    ? value
    : JSON.parse(
        JSON.stringify(value, (_key, v: unknown) => {
          if (typeof v === "string") return v.replaceAll(NUL, "");
          if (!v || typeof v !== "object" || Array.isArray(v)) return v;

          return Object.fromEntries(
            Object.entries(v).map(([k, item]) => [k.replaceAll(NUL, ""), item]),
          );
        }),
      );

/** Запись агента: `rev` — из колонки, она источник правды для условной записи. */
const agentOf = (row: {
  rev: number | string;
  record: object;
}): AgentRecord => ({
  ...(row.record as AgentRecord),
  rev: Number(row.rev),
});

interface IConfigRow {
  agent_id: string;
  worker: string;
  key: string;
  version: string | number;
  data: unknown;
  updated_at: string | number;
  actor: string | null;
}

/** Зашифрованное значение настройки в `jsonb`. */
interface ISealedConfig {
  $sealed: string;
}

const isSealed = (value: unknown): value is ISealedConfig =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as ISealedConfig).$sealed === "string" &&
  Object.keys(value).length === 1;

/**
 * Шифрование значений настроек в БД (в них бывают ключи и пароли):
 * `AGENT_CONFIGS_KEY` — AES-256-GCM, без него значения лежат как есть.
 * Прочитать можно и то и другое — ключ можно задать позже.
 */
class ConfigCipher {
  private readonly _key = agentConfig.configsKey
    ? parseSecretBoxKey(agentConfig.configsKey)
    : null;

  seal(data: unknown): unknown {
    if (!this._key) return data;

    return { $sealed: sealSecret(JSON.stringify(data ?? null), this._key) };
  }

  open(data: unknown): unknown {
    if (!isSealed(data)) return data;
    if (!this._key) {
      throw new Error("AGENT_CONFIGS_KEY не задан: настройка зашифрована");
    }

    return JSON.parse(openSecret(data.$sealed, this._key));
  }
}

/** Строки запроса `INSERT … RETURNING` (драйвер pg через TypeORM). */
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0])
    ? result[0]
    : result) as T[];

/**
 * `Store` SDK агентов на Postgres. Значения настроек — зашифрованы, если
 * задан `AGENT_CONFIGS_KEY`. Агент — строка `agents` с записью целиком в
 * `jsonb` и `rev` колонкой: запись — одним условным `UPDATE … WHERE rev = …`,
 * несколько процессов не затирают изменения друг друга. Настройки — строка
 * `agent_configs` на ключ; после удаления строка остаётся (`data = NULL`) со
 * счётчиком версии, поэтому версия ключа только растёт.
 */
@Injectable()
export class AgentStore implements Store {
  private readonly _cipher = new ConfigCipher();

  constructor(@inject(DataSource) private readonly _db: DataSource) {}

  private _configOf(row: IConfigRow): ConfigRecord {
    return {
      agentId: row.agent_id,
      worker: row.worker,
      key: row.key,
      version: Number(row.version),
      data: this._cipher.open(row.data),
      updatedAt: Number(row.updated_at),
      ...(row.actor ? { actor: row.actor } : {}),
    };
  }

  async createAgent(agent: AgentRecord): Promise<void> {
    const safe = jsonSafe(agent);

    await this._db.getRepository(StoredAgent).insert({
      id: safe.id,
      rev: safe.rev,
      name: safe.name,
      enrolledAt: safe.enrolledAt,
      record: safe,
    });
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    const row = await this._db.getRepository(StoredAgent).findOneBy({ id });

    return row ? agentOf(row) : undefined;
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = await this._db
      .getRepository(StoredAgent)
      .find({ order: { enrolledAt: "ASC", id: "ASC" } });

    return rows.map(agentOf);
  }

  async updateAgent(agent: AgentRecord): Promise<boolean> {
    const rev = agent.rev + 1;
    const safe = jsonSafe({ ...agent, rev });
    const { affected } = await this._db
      .createQueryBuilder()
      .update(StoredAgent)
      .set({ rev, name: safe.name, record: safe })
      .where("id = :id AND rev = :prev", { id: agent.id, prev: agent.rev })
      .execute();

    if (affected !== 1) return false;
    agent.rev = rev;

    return true;
  }

  /** Агент и его настройки — одной транзакцией. */
  deleteAgent(id: string): Promise<boolean> {
    return this._db.transaction(async manager => {
      await manager.getRepository(StoredAgentConfig).delete({ agentId: id });

      const { affected } = await manager
        .getRepository(StoredAgent)
        .delete({ id });

      return (affected ?? 0) > 0;
    });
  }

  /**
   * Версия — `max(счётчик + 1, minVersion)` одним `INSERT … ON CONFLICT`:
   * две записи одновременно получают разные версии. Значение пишется
   * JSON-текстом: `null` — это `'null'::jsonb`, а не удаление.
   */
  async setConfig(
    agentId: string,
    worker: string,
    key: string,
    data: unknown,
    opts: SetConfigOptions = {},
  ): Promise<ConfigRecord> {
    const result: unknown = await this._db.query(
      `INSERT INTO "agent_configs" ("agent_id", "worker", "key", "version", "data", "updated_at", "actor")
       VALUES ($1, $2, $3, GREATEST(1, $4::bigint), $5::jsonb, $6, $7)
       ON CONFLICT ("agent_id", "worker", "key") DO UPDATE SET
         "version" = GREATEST("agent_configs"."version" + 1, $4::bigint),
         "data" = EXCLUDED."data",
         "updated_at" = EXCLUDED."updated_at",
         "actor" = EXCLUDED."actor"
       RETURNING *`,
      [
        agentId,
        worker,
        key,
        opts.minVersion ?? 0,
        JSON.stringify(this._cipher.seal(jsonSafe(data) ?? null)),
        Date.now(),
        opts.actor ?? null,
      ],
    );

    return this._configOf(rowsOf<IConfigRow>(result)[0]);
  }

  async listConfigs(agentId: string): Promise<ConfigRecord[]> {
    const rows: IConfigRow[] = await this._db.query(
      `SELECT * FROM "agent_configs" WHERE "agent_id" = $1 AND "data" IS NOT NULL
       ORDER BY "worker", "key"`,
      [agentId],
    );

    return rows.map(row => this._configOf(row));
  }

  async deleteConfig(
    agentId: string,
    worker: string,
    key: string,
  ): Promise<boolean> {
    const { affected } = await this._db
      .createQueryBuilder()
      .update(StoredAgentConfig)
      .set({ data: () => "NULL", updatedAt: Date.now() })
      .where(
        "agent_id = :agentId AND worker = :worker AND key = :key AND data IS NOT NULL",
        { agentId, worker, key },
      )
      .execute();

    return (affected ?? 0) > 0;
  }
}
