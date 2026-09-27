import { asSecurityScheme, JwtSecurityScheme, TokenService } from "./auth";
import { Module } from "./decorators";
import { EventBus } from "./event-bus";
import { LoggerService } from "./logger";

/**
 * Базовые инфраструктурные сервисы: EventBus, Logger, TokenService и схема
 * аутентификации `jwt`. Импортируется AppModule первым.
 */
@Module({
  providers: [
    EventBus,
    LoggerService,
    TokenService,
    asSecurityScheme(JwtSecurityScheme),
  ],
})
export class CoreModule {}
