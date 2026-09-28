import { Module } from "../../core";
import { AppInfoController } from "./app-info.controller";
import { AppInfoService } from "./app-info.service";

/** Сведения о запущенном бэкенде (версия сборки). */
@Module({
  providers: [AppInfoService, AppInfoController],
})
export class AppInfoModule {}
