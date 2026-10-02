import "reflect-metadata";

import { CoreModule, Module, ObservabilityModule } from "./core";
import { ApiKeyModule } from "./modules/api-key";
import { AppInfoModule } from "./modules/app-info";
import { AuditModule } from "./modules/audit";
import { AuthModule } from "./modules/auth";
import { BiometricModule } from "./modules/biometric";
import { JobsModule } from "./modules/jobs";
import { MailerModule } from "./modules/mailer";
import { OtpModule } from "./modules/otp";
import { PasskeysModule } from "./modules/passkeys";
import { ProfileModule } from "./modules/profile";
import { ResetPasswordTokensModule } from "./modules/reset-password-tokens";
import { SessionModule } from "./modules/session/session.module";
import { SocketModule } from "./modules/socket";
import { UserModule } from "./modules/user";
import { WgAgentModule } from "./modules/wg-agent";
import { WgEndpointModule } from "./modules/wg-endpoint";
import { WgForwardModule } from "./modules/wg-forward";
import { WgInterfaceModule } from "./modules/wg-interface";
import { WgNodeModule } from "./modules/wg-node";
import { WgPeerModule } from "./modules/wg-peer";
import { WgProvisionModule } from "./modules/wg-provision";
import { WgSocksModule } from "./modules/wg-socks";
import { WgStatsModule } from "./modules/wg-stats";

/**
 * Корневой модуль приложения.
 */
@Module({
  imports: [
    // Инфраструктура
    CoreModule,
    ObservabilityModule,
    JobsModule,

    // Вспомогательные модули
    MailerModule,
    OtpModule,
    ResetPasswordTokensModule,

    // Пользователи, доступ, аутентификация
    UserModule,
    ProfileModule,
    AuthModule,
    SessionModule,
    ApiKeyModule,
    AuditModule,
    PasskeysModule,
    BiometricModule,

    // Модули проекта
    WgNodeModule,
    WgEndpointModule,
    WgForwardModule,
    WgSocksModule,
    WgInterfaceModule,
    WgPeerModule,
    WgStatsModule,
    WgAgentModule,
    WgProvisionModule,
    AppInfoModule,

    // Socket — последним, чтобы все ISocketHandler / ISocketEventListener были привязаны
    SocketModule,
  ],
})
export class AppModule {}
