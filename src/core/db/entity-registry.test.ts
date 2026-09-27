import "reflect-metadata";

import { expect } from "chai";
import { readdirSync } from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";

import { AppModule } from "../../app.module";
import { collectEntities } from "../decorators";

const MODULES_DIR = path.resolve(__dirname, "../../modules");

/** Все файлы `*.entity.ts` — ленивый глоб без внешних зависимостей. */
const entityFiles = readdirSync(MODULES_DIR, {
  recursive: true,
  encoding: "utf-8",
})
  .filter(file => file.endsWith(".entity.ts"))
  .map(file => path.join(MODULES_DIR, file));

describe("реестр сущностей", () => {
  it("каждая сущность из src/modules зарегистрирована в @Module({ entities })", () => {
    entityFiles.forEach(file => require(file));

    const declared = new Set(
      getMetadataArgsStorage()
        .tables.map(table => table.target)
        .filter((target): target is Function => typeof target === "function"),
    );
    const registered = new Set(collectEntities(AppModule));
    const missing = [...declared]
      .filter(entity => !registered.has(entity))
      .map(entity => entity.name);

    expect(entityFiles.length).to.be.greaterThan(0);
    expect(missing, "не зарегистрированы в модулях").to.deep.equal([]);
  });

  it("список без дублей и не пустой", () => {
    const entities = collectEntities(AppModule);

    expect(entities.length).to.be.greaterThan(0);
    expect(new Set(entities).size).to.equal(entities.length);
  });
});
