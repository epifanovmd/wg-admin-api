import { DataSource, EntityManager, ObjectLiteral, Repository } from "typeorm";

export abstract class BaseRepository<
  T extends ObjectLiteral,
> extends Repository<T> {
  constructor(
    private dataSource: DataSource,
    entity: new () => T,
  ) {
    super(entity, dataSource.manager);
  }

  createAndSave = (...args: Parameters<typeof this.save>) => {
    const entity = this.create(args[0]);

    return this.save(entity, args[1]);
  };

  createQueryRunner() {
    return this.dataSource.createQueryRunner();
  }

  withTransaction<R>(
    transactionCallback: (
      repository: Repository<T>,
      entityManager: EntityManager,
    ) => R,
  ) {
    return this.manager.transaction(async entityManager => {
      return transactionCallback(
        this.getRepository(entityManager),
        entityManager,
      );
    });
  }

  getRepository(entityManager: EntityManager) {
    return entityManager.getRepository(this.target);
  }
}
