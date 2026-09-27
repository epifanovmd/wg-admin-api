#!/usr/bin/env node
/**
 * Каркас модуля по конвенциям проекта.
 *
 *   yarn gen:module <name>            # name — kebab-case, единственное число: invoice, order-item
 *   yarn gen:module <name> --dry-run  # только показать файлы
 *
 * Создаёт src/modules/<name>/: entity, repository, service, controller, dto,
 * validation (zod), errors (defineErrors), events, module, README и тесты
 * сервиса и валидации. Регистрацию в app.module.ts и миграцию делает
 * разработчик — скрипт печатает, что добавить.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const fail = message => {
  process.stderr.write(`gen:module: ${message}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const name = args.find(arg => !arg.startsWith("--"));

if (!name) fail("укажите имя модуля: yarn gen:module <name>");
if (!NAME_RE.test(name)) {
  fail(
    `имя «${name}» — kebab-case латиницей в единственном числе: invoice, order-item`,
  );
}

const pluralize = word =>
  /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(word)
      ? `${word}es`
      : `${word}s`;

const words = name.split("-");
const pascal = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
const camel = pascal[0].toLowerCase() + pascal.slice(1);
const upper = words.join("_").toUpperCase();
const pluralKebab = [...words.slice(0, -1), pluralize(words.at(-1))].join("-");
const table = pluralKebab.replaceAll("-", "_");
const tablePrefix = table.toUpperCase();

const n = {
  kebab: name,
  pascal,
  camel,
  upper,
  pluralKebab,
  table,
  entity: pascal,
  dto: `${pascal}Dto`,
  service: `${pascal}Service`,
  repository: `${pascal}Repository`,
  controller: `${pascal}Controller`,
  module: `${pascal}Module`,
  error: `${pascal}Error`,
};

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

// ─── Шаблоны ──────────────────────────────────────────────────────────────

const types =
  () => `/** Максимальная длина названия — совпадает с колонкой \`name\`. */
export const ${upper}_NAME_MAX = ${NAME_MAX};
/** Максимальная длина описания. */
export const ${upper}_DESCRIPTION_MAX = ${DESCRIPTION_MAX};
`;

const entity = () => `import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { ${upper}_NAME_MAX } from "./${n.kebab}.types";

@Entity("${table}")
@Index("IDX_${tablePrefix}_OWNER_CREATED", ["ownerId", "createdAt"])
export class ${n.entity} {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Владелец записи — пользователь, создавший её. */
  @Column({ name: "owner_id", type: "uuid" })
  ownerId!: string;

  @Column({ type: "varchar", length: ${upper}_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
`;

const repository = () => `import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { ${n.entity} } from "./${n.kebab}.entity";

@InjectableRepository(${n.entity})
export class ${n.repository} extends BaseRepository<${n.entity}> {
  /** Страница записей владельца, новые первыми. */
  findPageByOwner(
    ownerId: string,
    { offset, limit }: Pagination,
  ): Promise<[${n.entity}[], number]> {
    return this.findAndCount({
      where: { ownerId },
      order: { createdAt: "DESC", id: "DESC" },
      skip: offset,
      take: limit,
    });
  }

  findOwned(id: string, ownerId: string): Promise<${n.entity} | null> {
    return this.findOne({ where: { id, ownerId } });
  }
}
`;

const errors = () => `import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды \`${upper}_*\`. */
export const ${n.error} = defineErrors("${upper}", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Запись не найдена",
  },
});
`;

const service = () => `import { inject } from "inversify";

import type { IPaginatedDto, Pagination } from "../../core";
import { EventBus, Injectable, toPage } from "../../core";
import { ${n.dto} } from "./dto";
import type { ICreate${pascal}Body, IUpdate${pascal}Body } from "./dto";
import { ${n.entity} } from "./${n.kebab}.entity";
import { ${n.error} } from "./${n.kebab}.errors";
import { ${n.repository} } from "./${n.kebab}.repository";
import {
  ${pascal}CreatedEvent,
  ${pascal}DeletedEvent,
  ${pascal}UpdatedEvent,
} from "./events";

/** Записи пользователя: создание, список, изменение, удаление — только свои. */
@Injectable()
export class ${n.service} {
  constructor(
    @inject(${n.repository}) private readonly _repo: ${n.repository},
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  async create(ownerId: string, body: ICreate${pascal}Body): Promise<${n.dto}> {
    const saved = await this._repo.createAndSave({
      ownerId,
      name: body.name,
      description: body.description ?? null,
    });
    const dto = ${n.dto}.fromEntity(saved);

    this._eventBus.emit(new ${pascal}CreatedEvent(dto));

    return dto;
  }

  async list(
    ownerId: string,
    pagination: Pagination,
  ): Promise<IPaginatedDto<${n.dto}>> {
    const [items, total] = await this._repo.findPageByOwner(ownerId, pagination);

    return toPage(items.map(${n.dto}.fromEntity), total, pagination);
  }

  async get(ownerId: string, id: string): Promise<${n.dto}> {
    return ${n.dto}.fromEntity(await this._findOwnedOrFail(ownerId, id));
  }

  async update(
    ownerId: string,
    id: string,
    body: IUpdate${pascal}Body,
  ): Promise<${n.dto}> {
    const entity = await this._findOwnedOrFail(ownerId, id);

    if (body.name !== undefined) entity.name = body.name;
    if (body.description !== undefined) entity.description = body.description;

    const dto = ${n.dto}.fromEntity(await this._repo.save(entity));

    this._eventBus.emit(new ${pascal}UpdatedEvent(dto));

    return dto;
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const entity = await this._findOwnedOrFail(ownerId, id);

    await this._repo.delete({ id: entity.id });
    this._eventBus.emit(new ${pascal}DeletedEvent(entity.id, ownerId));
  }

  /** Чужая запись — 404: существование не раскрывается. */
  private async _findOwnedOrFail(
    ownerId: string,
    id: string,
  ): Promise<${n.entity}> {
    const entity = await this._repo.findOwned(id, ownerId);

    if (!entity) throw ${n.error}.NOT_FOUND();

    return entity;
  }
}
`;

const controller = () => `import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto, IPaginatedDto } from "../../core";
import {
  getContextUser,
  Injectable,
  normalizePagination,
  ValidateBody,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { ${n.dto}, ICreate${pascal}Body, IUpdate${pascal}Body } from "./dto";
import { ${n.service} } from "./${n.kebab}.service";
import { Create${pascal}Schema, Update${pascal}Schema } from "./validation";

@Injectable()
@Tags("${pascal}")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/${pluralKebab}")
export class ${n.controller} extends Controller {
  constructor(@inject(${n.service}) private readonly _service: ${n.service}) {
    super();
  }

  /**
   * Создать запись.
   * @summary Создание
   */
  @Security("jwt")
  @ValidateBody(Create${pascal}Schema)
  @SuccessResponse(201, "Created")
  @Post()
  create(
    @Request() req: KoaRequest,
    @Body() body: ICreate${pascal}Body,
  ): Promise<${n.dto}> {
    return this._service.create(getContextUser(req).userId, body);
  }

  /**
   * Свои записи, новые первыми.
   * @summary Список
   */
  @Security("jwt")
  @Get()
  list(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<${n.dto}>> {
    return this._service.list(
      getContextUser(req).userId,
      normalizePagination(offset, limit),
    );
  }

  /**
   * Запись по id; чужая — 404.
   * @summary Запись
   */
  @Security("jwt")
  @Get("{id}")
  get(@Request() req: KoaRequest, @Path() id: UUID): Promise<${n.dto}> {
    return this._service.get(getContextUser(req).userId, id);
  }

  /**
   * Изменить запись: переданные поля заменяются.
   * @summary Изменение
   */
  @Security("jwt")
  @ValidateBody(Update${pascal}Schema)
  @Patch("{id}")
  update(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdate${pascal}Body,
  ): Promise<${n.dto}> {
    return this._service.update(getContextUser(req).userId, id, body);
  }

  /**
   * Удалить запись.
   * @summary Удаление
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async delete(@Request() req: KoaRequest, @Path() id: UUID): Promise<void> {
    await this._service.delete(getContextUser(req).userId, id);
  }
}
`;

const dto = () => `import { BaseDto } from "../../../core";
import type { ${n.entity} } from "../${n.kebab}.entity";

export class ${n.dto} extends BaseDto {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: ${n.entity}) {
    super(entity);

    this.id = entity.id;
    this.ownerId = entity.ownerId;
    this.name = entity.name;
    this.description = entity.description;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: ${n.entity}) {
    return new ${n.dto}(entity);
  }
}
`;

const requestDto = () => `export interface ICreate${pascal}Body {
  name: string;
  description?: string | null;
}

export interface IUpdate${pascal}Body {
  name?: string;
  description?: string | null;
}
`;

const dtoIndex = () => `export * from "./${n.kebab}.dto";
export * from "./${n.kebab}-request.dto";
`;

const validation = () => `import { z } from "zod";

import {
  ${upper}_DESCRIPTION_MAX,
  ${upper}_NAME_MAX,
} from "../${n.kebab}.types";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(${upper}_NAME_MAX, \`Название — не длиннее \${${upper}_NAME_MAX} символов\`);

const description = z
  .string()
  .trim()
  .max(
    ${upper}_DESCRIPTION_MAX,
    \`Описание — не длиннее \${${upper}_DESCRIPTION_MAX} символов\`,
  )
  .nullable();

export const Create${pascal}Schema = z.object({
  name,
  description: description.optional(),
});

export const Update${pascal}Schema = z
  .object({
    name: name.optional(),
    description: description.optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });
`;

const validationIndex = () => `export * from "./${n.kebab}.validate";
`;

const validationTest = () => `import { expect } from "chai";

import { ${upper}_NAME_MAX } from "../${n.kebab}.types";
import { Create${pascal}Schema, Update${pascal}Schema } from "./${n.kebab}.validate";

describe("${pascal} validation", () => {
  describe("Create${pascal}Schema", () => {
    it("принимает название и обрезает пробелы", () => {
      const result = Create${pascal}Schema.safeParse({ name: "  Первая  " });

      expect(result.success).to.be.true;
      expect(result.data?.name).to.equal("Первая");
    });

    it("отклоняет пустое и слишком длинное название", () => {
      expect(Create${pascal}Schema.safeParse({ name: "   " }).success).to.be
        .false;
      expect(
        Create${pascal}Schema.safeParse({
          name: "x".repeat(${upper}_NAME_MAX + 1),
        }).success,
      ).to.be.false;
    });

    it("описание необязательно и может быть null", () => {
      expect(
        Create${pascal}Schema.safeParse({ name: "a", description: null }).success,
      ).to.be.true;
    });
  });

  describe("Update${pascal}Schema", () => {
    it("требует хотя бы одно поле", () => {
      expect(Update${pascal}Schema.safeParse({}).success).to.be.false;
      expect(Update${pascal}Schema.safeParse({ name: "b" }).success).to.be.true;
    });
  });
});
`;

const event = (kind, fields, doc) => `/** ${doc} */
export class ${pascal}${kind}Event {
  constructor(${fields}) {}
}
`;

const eventsIndex = () => `export * from "./${n.kebab}-created.event";
export * from "./${n.kebab}-deleted.event";
export * from "./${n.kebab}-updated.event";
`;

const moduleFile = () => `import { Module } from "../../core";
import { ${n.controller} } from "./${n.kebab}.controller";
import { ${n.entity} } from "./${n.kebab}.entity";
import { ${n.repository} } from "./${n.kebab}.repository";
import { ${n.service} } from "./${n.kebab}.service";

@Module({
  entities: [${n.entity}],
  providers: [${n.repository}, ${n.service}, ${n.controller}],
})
export class ${n.module} {}
`;

const index = () => `export * from "./dto";
export * from "./events";
export * from "./${n.kebab}.controller";
export * from "./${n.kebab}.entity";
export * from "./${n.kebab}.errors";
export * from "./${n.kebab}.module";
export * from "./${n.kebab}.repository";
export * from "./${n.kebab}.service";
export * from "./${n.kebab}.types";
`;

const serviceTest = () => `import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { HttpException } from "../../core";
import { createMockEventBus, createMockRepository, uuid, uuid2 } from "../../test/helpers";
import {
  ${pascal}CreatedEvent,
  ${pascal}DeletedEvent,
  ${pascal}UpdatedEvent,
} from "./events";
import { ${n.error} } from "./${n.kebab}.errors";
import { ${n.service} } from "./${n.kebab}.service";

describe("${n.service}", () => {
  let service: ${n.service};
  let repo: ReturnType<typeof createMockRepository> & {
    findPageByOwner: sinon.SinonStub;
    findOwned: sinon.SinonStub;
  };
  let eventBus: ReturnType<typeof createMockEventBus>;

  const ownerId = uuid();
  const id = uuid2();
  const makeEntity = (overrides: Record<string, unknown> = {}) => ({
    id,
    ownerId,
    name: "Название",
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    repo = Object.assign(createMockRepository(), {
      findPageByOwner: sinon.stub().resolves([[], 0]),
      findOwned: sinon.stub().resolves(null),
    });
    eventBus = createMockEventBus();
    service = new ${n.service}(repo as any, eventBus as any);
  });

  describe("create", () => {
    it("сохраняет запись владельца и эмитит событие", async () => {
      repo.createAndSave.resolves(makeEntity({ name: "Новая" }));

      const dto = await service.create(ownerId, { name: "Новая" });

      expect(repo.createAndSave.firstCall.args[0]).to.deep.equal({
        ownerId,
        name: "Новая",
        description: null,
      });
      expect(dto.name).to.equal("Новая");
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        ${pascal}CreatedEvent,
      );
    });
  });

  describe("list", () => {
    it("отдаёт страницу IPaginatedDto", async () => {
      repo.findPageByOwner.resolves([[makeEntity()], 7]);

      const page = await service.list(ownerId, { offset: 5, limit: 1 });

      expect(repo.findPageByOwner.calledOnceWith(ownerId, { offset: 5, limit: 1 }))
        .to.be.true;
      expect(page.total).to.equal(7);
      expect(page.offset).to.equal(5);
      expect(page.limit).to.equal(1);
      expect(page.items).to.have.length(1);
    });
  });

  describe("get / update / delete", () => {
    it("чужая или несуществующая запись — ${upper}_NOT_FOUND", async () => {
      for (const call of [
        () => service.get(ownerId, id),
        () => service.update(ownerId, id, { name: "x" }),
        () => service.delete(ownerId, id),
      ]) {
        const err = await call().catch((e: unknown) => e);

        expect(err).to.be.instanceOf(HttpException);
        expect((err as HttpException).code).to.equal(${n.error}.codes.NOT_FOUND);
        expect((err as HttpException).status).to.equal(404);
      }
      expect(repo.findOwned.alwaysCalledWith(id, ownerId)).to.be.true;
    });

    it("update меняет только переданные поля", async () => {
      repo.findOwned.resolves(makeEntity({ description: "старое" }));

      const dto = await service.update(ownerId, id, { name: "Новое" });

      expect(dto.name).to.equal("Новое");
      expect(dto.description).to.equal("старое");
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        ${pascal}UpdatedEvent,
      );
    });

    it("delete удаляет запись и эмитит событие", async () => {
      repo.findOwned.resolves(makeEntity());

      await service.delete(ownerId, id);

      expect(repo.delete.calledOnceWith({ id })).to.be.true;
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        ${pascal}DeletedEvent,
      );
    });
  });
});
`;

const readme = () => `# Модуль ${pascal}

Записи пользователя (${table}): создание, постраничный список, изменение и
удаление — только своих. Каркас создан \`yarn gen:module ${n.kebab}\`; опишите
здесь предметную область, когда модуль обрастёт логикой.

## Сущности

### ${n.entity} (\`${table}\`)

| Поле          | Тип                      | Описание                    |
| ------------- | ------------------------ | --------------------------- |
| \`id\`          | \`uuid\` (PK)              |                             |
| \`ownerId\`     | \`uuid\`                   | Владелец (создатель)        |
| \`name\`        | \`varchar(${NAME_MAX})\`             | Название                    |
| \`description\` | \`text\`, nullable         | Описание, до ${DESCRIPTION_MAX} символов |
| \`createdAt\`   | \`timestamptz\`            |                             |
| \`updatedAt\`   | \`timestamptz\`            |                             |

Индекс \`IDX_${tablePrefix}_OWNER_CREATED\` (\`ownerId\`, \`createdAt\`) — список владельца.

## Эндпоинты

Базовый путь \`/api/v1/${pluralKebab}\`, тег \`${pascal}\`, все — \`@Security("jwt")\`.
Чужая запись — 404 (\`${upper}_NOT_FOUND\`), неверный uuid в пути — 422.

| Метод    | Путь      | Описание                                 | Ответ                         |
| -------- | --------- | ---------------------------------------- | ----------------------------- |
| \`POST\`   | \`/\`       | Создать (\`Create${pascal}Schema\`)       | 201 \`${n.dto}\`               |
| \`GET\`    | \`/\`       | Свои записи, \`?offset=&limit=\`         | \`IPaginatedDto<${n.dto}>\`     |
| \`GET\`    | \`/{id}\`   | Запись                                   | \`${n.dto}\`                   |
| \`PATCH\`  | \`/{id}\`   | Изменить (\`Update${pascal}Schema\`)      | \`${n.dto}\`                   |
| \`DELETE\` | \`/{id}\`   | Удалить                                  | 204                           |

## Ошибки

| Код                   | Статус | Когда                            |
| --------------------- | ------ | -------------------------------- |
| \`${upper}_NOT_FOUND\` | 404    | Записи нет или она чужая         |
| \`VALIDATION_ERROR\`    | 400    | Тело не прошло Zod-схему          |

## События (EventBus)

| Событие                   | Payload                   | Когда                  |
| ------------------------- | ------------------------- | ---------------------- |
| \`${pascal}CreatedEvent\` | \`item: ${n.dto}\`           | После создания         |
| \`${pascal}UpdatedEvent\` | \`item: ${n.dto}\`           | После изменения        |
| \`${pascal}DeletedEvent\` | \`id\`, \`ownerId\`           | После удаления         |

## Задачи и конфиг

Нет.
`;

// ─── Запись ───────────────────────────────────────────────────────────────

const dir = path.join(ROOT, "src", "modules", n.kebab);
const files = {
  [`${n.kebab}.types.ts`]: types(),
  [`${n.kebab}.entity.ts`]: entity(),
  [`${n.kebab}.repository.ts`]: repository(),
  [`${n.kebab}.errors.ts`]: errors(),
  [`${n.kebab}.service.ts`]: service(),
  [`${n.kebab}.service.test.ts`]: serviceTest(),
  [`${n.kebab}.controller.ts`]: controller(),
  [`${n.kebab}.module.ts`]: moduleFile(),
  "index.ts": index(),
  "README.md": readme(),
  [`dto/${n.kebab}.dto.ts`]: dto(),
  [`dto/${n.kebab}-request.dto.ts`]: requestDto(),
  "dto/index.ts": dtoIndex(),
  [`validation/${n.kebab}.validate.ts`]: validation(),
  [`validation/${n.kebab}.validation.test.ts`]: validationTest(),
  "validation/index.ts": validationIndex(),
  [`events/${n.kebab}-created.event.ts`]: event(
    "Created",
    `public readonly item: ${n.dto}`,
    "Запись создана.",
  ).replace(/^/, `import type { ${n.dto} } from "../dto";\n\n`),
  [`events/${n.kebab}-updated.event.ts`]: event(
    "Updated",
    `public readonly item: ${n.dto}`,
    "Запись изменена.",
  ).replace(/^/, `import type { ${n.dto} } from "../dto";\n\n`),
  [`events/${n.kebab}-deleted.event.ts`]: event(
    "Deleted",
    "\n    public readonly id: string,\n    public readonly ownerId: string,\n  ",
    "Запись удалена.",
  ),
  "events/index.ts": eventsIndex(),
};

if (existsSync(dir))
  fail(`каталог уже существует: ${path.relative(ROOT, dir)}`);

const relDir = path.relative(ROOT, dir);

if (dryRun) {
  Object.keys(files).forEach(file =>
    process.stdout.write(`${path.join(relDir, file)}\n`),
  );
  process.exit(0);
}

for (const [file, content] of Object.entries(files)) {
  const target = path.join(dir, file);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// Форматирование и сортировка импортов — как у остального кода (best effort).
const bin = tool => path.join(ROOT, "node_modules", ".bin", tool);
const run = (tool, toolArgs) =>
  existsSync(bin(tool)) &&
  spawnSync(bin(tool), toolArgs, { cwd: ROOT, stdio: "ignore" });

run("prettier", ["--write", relDir]);
run("eslint", ["--fix", relDir]);

process.stdout
  .write(`Модуль создан: ${relDir}/ (${Object.keys(files).length} файлов)

Дальше:
  1. src/app.module.ts — импорт и регистрация:
       import { ${n.module} } from "./modules/${n.kebab}";
       @Module({ imports: [ ..., ${n.module}, ... SocketModule] })  // до SocketModule
  2. yarn generate                                  # маршруты и OpenAPI
  3. yarn migration:generate src/migrations/Create${pascal}
     и добавить миграцию в src/migrations/index.ts
  4. yarn test:file ${relDir}/${n.kebab}.service.test.ts
`);
