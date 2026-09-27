import { asSecurityScheme, Module } from "../../core";
import { ApiKeyController } from "./api-key.controller";
import { ApiKey } from "./api-key.entity";
import { ApiKeyRepository } from "./api-key.repository";
import { ApiKeySecurityScheme } from "./api-key.scheme";
import { ApiKeyService } from "./api-key.service";

/** API-ключи сервисов: схема аутентификации apiKey со scope. */
@Module({
  entities: [ApiKey],
  providers: [
    ApiKeyRepository,
    ApiKeyService,
    ApiKeyController,
    asSecurityScheme(ApiKeySecurityScheme),
  ],
})
export class ApiKeyModule {}
