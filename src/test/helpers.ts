import sinon from "sinon";

/**
 * Creates a mock repository with stubbed TypeORM methods.
 */
export const createMockRepository = () => ({
  find: sinon.stub().resolves([]),
  findOne: sinon.stub().resolves(null),
  findAndCount: sinon.stub().resolves([[], 0]),
  save: sinon
    .stub()
    .callsFake((entity: any) => Promise.resolve({ id: "test-id", ...entity })),
  create: sinon.stub().callsFake((data: any) => ({ ...data })),
  createAndSave: sinon
    .stub()
    .callsFake((data: any) => Promise.resolve({ id: "test-id", ...data })),
  update: sinon.stub().resolves({ affected: 1 }),
  delete: sinon.stub().resolves({ affected: 1 }),
  count: sinon.stub().resolves(0),
  createQueryBuilder: sinon.stub().returns(createMockQueryBuilder()),
  withTransaction: sinon.stub().callsFake(async (cb: any) => {
    const mockRepo = createMockRepository();
    const mockEm = {
      getRepository: sinon.stub().returns(createMockRepository()),
    };

    return cb(mockRepo, mockEm);
  }),
});

export const createMockQueryBuilder = () => {
  const qb: any = {};

  const methods = [
    "select",
    "addSelect",
    "where",
    "andWhere",
    "orWhere",
    "leftJoin",
    "innerJoin",
    "leftJoinAndSelect",
    "innerJoinAndSelect",
    "orderBy",
    "addOrderBy",
    "skip",
    "take",
    "groupBy",
    "set",
    "update",
    "insert",
    "delete",
  ];

  for (const method of methods) {
    qb[method] = sinon.stub().returns(qb);
  }

  qb.getMany = sinon.stub().resolves([]);
  qb.getOne = sinon.stub().resolves(null);
  qb.getManyAndCount = sinon.stub().resolves([[], 0]);
  qb.getCount = sinon.stub().resolves(0);
  qb.getRawOne = sinon.stub().resolves(null);
  qb.getRawMany = sinon.stub().resolves([]);
  qb.execute = sinon.stub().resolves({ affected: 1 });

  return qb;
};

export const createMockEventBus = () => ({
  emit: sinon.stub(),
  emitAsync: sinon.stub().resolves(),
  on: sinon.stub().returns(() => {}),
  once: sinon.stub().returns(() => {}),
  off: sinon.stub(),
  clear: sinon.stub(),
});

export const createMockEmitter = () => ({
  toUser: sinon.stub(),
  toRoom: sinon.stub(),
  broadcast: sinon.stub(),
  joinRoom: sinon.stub(),
  leaveRoom: sinon.stub(),
  disconnectUser: sinon.stub(),
  disconnectSession: sinon.stub().resolves(),
});

export const uuid = () => "00000000-0000-0000-0000-000000000001";
export const uuid2 = () => "00000000-0000-0000-0000-000000000002";
export const uuid3 = () => "00000000-0000-0000-0000-000000000003";

/** Очередь задач: `enqueue` запоминает вызовы, задачи не выполняются. */
export const createMockJobQueue = () => ({
  enqueue: sinon.stub().resolves("job-id"),
  cancel: sinon.stub().resolves(),
});
