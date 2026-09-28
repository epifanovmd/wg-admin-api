import { asSecurityScheme, Module } from "../../core";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { ApiKeyController } from "./api-key.controller";
import { ApiKey } from "./api-key.entity";
import { API_KEYS_ROOM, ApiKeyListener } from "./api-key.listener";
import { ApiKeyPermissions } from "./api-key.permissions";
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
    asSocketListener(ApiKeyListener),
    asSocketRoomPolicy(
      permissionRoomPolicy(API_KEYS_ROOM, ApiKeyPermissions.VIEW),
    ),
  ],
})
export class ApiKeyModule {}
