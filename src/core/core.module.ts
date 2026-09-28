import {
  AccessService,
  asSecurityScheme,
  JwtSecurityScheme,
  TokenService,
} from "./auth";
import { Module } from "./decorators";
import { EventBus } from "./event-bus";
import { LoggerService } from "./logger";

/**
 * Базовые инфраструктурные сервисы: EventBus, Logger, TokenService,
 * AccessService (права по userId; источник — `GRANT_RESOLVER` модуля
 * пользователей) и схема аутентификации `jwt`. Импортируется AppModule первым.
 */
@Module({
  providers: [
    EventBus,
    LoggerService,
    TokenService,
    AccessService,
    asSecurityScheme(JwtSecurityScheme),
  ],
})
export class CoreModule {}
