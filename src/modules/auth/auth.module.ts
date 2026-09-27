import { Module } from "../../core/decorators/module.decorator";
import { asSocketListener } from "../socket";
import { asPasswordPolicy } from "../user";
import { AuthController } from "./auth.controller";
import { AuthListener } from "./auth.listener";
import { AuthService } from "./auth.service";
import { AuthAttemptsStore } from "./auth-attempts.store";
import { AuthPasswordPolicy } from "./auth-password.policy";

@Module({
  providers: [
    AuthAttemptsStore,
    AuthController,
    AuthService,
    asSocketListener(AuthListener),
    asPasswordPolicy(AuthPasswordPolicy),
  ],
})
export class AuthModule {}
