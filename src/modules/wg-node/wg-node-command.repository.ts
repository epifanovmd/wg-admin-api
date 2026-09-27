import { LessThan } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { EWgNodeCommandStatus } from "./wg-node.types";
import { WgNodeCommand } from "./wg-node-command.entity";

const ACTIVE_STATUSES = [
  EWgNodeCommandStatus.Pending,
  EWgNodeCommandStatus.Running,
];

@InjectableRepository(WgNodeCommand)
export class WgNodeCommandRepository extends BaseRepository<WgNodeCommand> {
  /** Невыполненные команды ноды — отдаются агенту в порядке создания. */
  findPendingByNode(nodeId: string): Promise<WgNodeCommand[]> {
    return this.find({
      where: { nodeId, status: EWgNodeCommandStatus.Pending },
      order: { createdAt: "ASC" },
    });
  }

  /** Активные команды, у которых вышел срок (создание + таймаут + запас). */
  findExpired(graceSec: number): Promise<WgNodeCommand[]> {
    return this.createQueryBuilder("command")
      .where("command.status IN (:...statuses)", { statuses: ACTIVE_STATUSES })
      .andWhere(
        "command.created_at + (command.timeout_sec + :graceSec) * interval '1 second' < now()",
        { graceSec },
      )
      .getMany();
  }

  /**
   * Атомарный перевод статуса: только из ожидаемых состояний.
   * Возвращает, применился ли переход.
   */
  async transitionStatus(
    id: string,
    from: EWgNodeCommandStatus[],
    patch: Partial<WgNodeCommand>,
  ): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(WgNodeCommand)
      .set(patch)
      .where("id = :id", { id })
      .andWhere("status IN (:...from)", { from })
      .execute();

    return result.affected === 1;
  }

  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    const result = await this.createQueryBuilder()
      .delete()
      .where({ createdAt: LessThan(cutoff) })
      .andWhere("status NOT IN (:...statuses)", { statuses: ACTIVE_STATUSES })
      .execute();

    return result.affected ?? 0;
  }
}
