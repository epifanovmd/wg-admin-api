import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { WgEndpoint } from "./wg-endpoint.entity";

@InjectableRepository(WgEndpoint)
export class WgEndpointRepository extends BaseRepository<WgEndpoint> {
  findPage(
    query: string | undefined,
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

    return qb.getManyAndCount();
  }
}
