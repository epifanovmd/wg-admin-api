import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { WgEndpointAccess } from "./wg-endpoint.access";
import { WgEndpoint } from "./wg-endpoint.entity";

export interface IWgEndpointFilters {
  query?: string;
  /** Только свои точки пользователя: владелец или создатель. */
  ownedBy?: string;
}

@InjectableRepository(WgEndpoint)
export class WgEndpointRepository extends BaseRepository<WgEndpoint> {
  findPage(
    { query, ownedBy }: IWgEndpointFilters,
    { offset, limit }: Pagination,
  ): Promise<[WgEndpoint[], number]> {
    const qb = this.createQueryBuilder("endpoint")
      .orderBy("endpoint.createdAt", "DESC")
      .addOrderBy("endpoint.id", "DESC")
      .skip(offset)
      .take(limit);

    if (query) {
      qb.andWhere(
        "(endpoint.name ILIKE :query OR endpoint.host ILIKE :query)",
        {
          query: `%${query}%`,
        },
      );
    }

    if (ownedBy) {
      qb.andWhere(WgEndpointAccess.ownedCondition("endpoint"), { ownedBy });
    }

    return qb.getManyAndCount();
  }
}
