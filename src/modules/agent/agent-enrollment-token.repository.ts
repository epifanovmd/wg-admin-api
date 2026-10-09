import { IsNull } from "typeorm";

import { InjectableRepository } from "../../core";
import { BaseRepository } from "../../core/repository/repository";
import { AgentEnrollmentToken } from "./agent-enrollment-token.entity";

@InjectableRepository(AgentEnrollmentToken)
export class AgentEnrollmentTokenRepository extends BaseRepository<AgentEnrollmentToken> {
  findById(id: string): Promise<AgentEnrollmentToken | null> {
    return this.findOneBy({ id });
  }

  findByPrefix(prefix: string): Promise<AgentEnrollmentToken | null> {
    return this.findOneBy({ prefix });
  }

  findPage(
    offset: number,
    limit: number,
  ): Promise<[AgentEnrollmentToken[], number]> {
    return this.findAndCount({
      order: { createdAt: "DESC" },
      skip: offset,
      take: limit,
    });
  }

  /**
   * Использовать токен одним условным `UPDATE`: не отозван, не истёк, лимит
   * не исчерпан. `false` — токен больше не годится (в том числе из-за
   * одновременной регистрации).
   */
  async consume(id: string, now: Date): Promise<boolean> {
    const { affected } = await this.createQueryBuilder()
      .update()
      .set({ uses: () => "uses + 1" })
      .where("id = :id", { id })
      .andWhere("revoked_at IS NULL")
      .andWhere("(expires_at IS NULL OR expires_at > :now)", { now })
      .andWhere("(max_uses IS NULL OR uses < max_uses)")
      .execute();

    return (affected ?? 0) > 0;
  }

  /** Отозвать; `false` — уже отозван. */
  async revoke(id: string, now: Date): Promise<boolean> {
    const { affected } = await this.update(
      { id, revokedAt: IsNull() },
      { revokedAt: now },
    );

    return (affected ?? 0) > 0;
  }
}
