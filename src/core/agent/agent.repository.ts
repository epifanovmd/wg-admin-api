import { IsNull, Not } from "typeorm";

import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { Agent } from "./agent.entity";

@InjectableRepository(Agent)
export class AgentRepository extends BaseRepository<Agent> {
  /** Запись агента, в том числе удалённого (вход по ключу: удалённому — 403). */
  findById(id: string): Promise<Agent | null> {
    return this.findOneBy({ id });
  }

  /** Агент, если не удалён. */
  findLive(id: string): Promise<Agent | null> {
    return this.findOneBy({ id, deletedAt: IsNull() });
  }

  findAll(): Promise<Agent[]> {
    return this.find({
      where: { deletedAt: IsNull() },
      order: { enrolledAt: "ASC" },
    });
  }

  findPage(offset: number, limit: number): Promise<[Agent[], number]> {
    return this.findAndCount({
      where: { deletedAt: IsNull() },
      order: { enrolledAt: "ASC" },
      skip: offset,
      take: limit,
    });
  }

  /** Поднять номер желаемого; вернуть новый. */
  async bumpDesired(id: string): Promise<number> {
    const rows: Array<{ desired_rev: string }> = await this.query(
      "UPDATE agents SET desired_rev = desired_rev + 1, updated_at = now() WHERE id = $1 RETURNING desired_rev",
      [id],
    );

    return rows.length ? Number(rows[0].desired_rev) : 0;
  }

  /** Отметить связь: последний запрос и адрес. */
  async touch(id: string, remoteIp: string | null): Promise<void> {
    await this.update({ id }, { lastSeenAt: new Date(), remoteIp });
  }

  /**
   * Поток открыт копией `instance` (или закрыт — `null`, только если он её): закрытый поток
   * сбрасывает и последнюю связь — агент без связи, пока снова не подключится или не спросит.
   */
  async setStream(
    id: string,
    instance: string | null,
    owner?: string,
  ): Promise<boolean> {
    const qb = this.createQueryBuilder()
      .update()
      .set({
        streamInstance: instance,
        lastSeenAt: instance ? new Date() : null,
      })
      .where("id = :id", { id });

    if (owner) qb.andWhere("stream_instance = :owner", { owner });
    const { affected } = await qb.execute();

    return (affected ?? 0) > 0;
  }

  /** Сбросить потоки копии (её прежний запуск оборвался). */
  async clearStreams(instance: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.query(
      "UPDATE agents SET stream_instance = NULL, last_seen_at = NULL WHERE stream_instance = $1 RETURNING id",
      [instance],
    );

    return rows.map(r => r.id);
  }

  withStream(): Promise<Agent[]> {
    return this.findBy({ streamInstance: Not(IsNull()) });
  }
}
