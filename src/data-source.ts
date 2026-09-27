import "reflect-metadata";

import { AppModule } from "./app.module";
import { collectEntities, createDataSource } from "./core";
import { migrations } from "./migrations";

/**
 * Единственный DataSource приложения: сущности — из реестра модулей,
 * миграции — из явного списка. Этот же файл читает CLI TypeORM
 * (`-d src/data-source.ts` / `build/data-source.js`).
 */
const AppDataSource = createDataSource({
  entities: collectEntities(AppModule),
  migrations,
});

export default AppDataSource;
