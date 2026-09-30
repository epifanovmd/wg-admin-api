import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { joinUserName } from "../user/user-name";
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
    const qb = this._withOwners()
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

  /** Точка с именами владельца и создателя. */
  findWithOwners(id: string): Promise<WgEndpoint | null> {
    return this._withOwners().where("endpoint.id = :id", { id }).getOne();
  }

  /** Точки с именами владельца и создателя. */
  findManyWithOwners(ids: string[]): Promise<WgEndpoint[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this._withOwners()
      .where("endpoint.id IN (:...ids)", { ids })
      .getMany();
  }

  private _withOwners() {
    const qb = this.createQueryBuilder("endpoint");

    joinUserName(qb, "endpoint.owner", "owner");
    joinUserName(qb, "endpoint.createdBy", "createdBy");

    return qb;
  }
}
