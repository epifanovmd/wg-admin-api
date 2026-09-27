import { IsNull, LessThan } from "typeorm";

import { InjectableRepository } from "../../core";
import { BaseRepository } from "../../core/repository/repository";
import { ApiKey } from "./api-key.entity";

@InjectableRepository(ApiKey)
export class ApiKeyRepository extends BaseRepository<ApiKey> {
  findById(id: string): Promise<ApiKey | null> {
    return this.findOne({ where: { id } });
  }

  findByPrefix(prefix: string): Promise<ApiKey | null> {
    return this.findOne({ where: { prefix } });
  }

  findPage(offset: number, limit: number): Promise<[ApiKey[], number]> {
    return this.findAndCount({
      order: { createdAt: "DESC" },
      skip: offset,
      take: limit,
    });
  }

  /** Отметить использование, если прошлая отметка старше `before`. */
  async touch(id: string, now: Date, before: Date): Promise<void> {
    await this.update(
      [
        { id, lastUsedAt: IsNull() },
        { id, lastUsedAt: LessThan(before) },
      ],
      { lastUsedAt: now },
    );
  }
}
