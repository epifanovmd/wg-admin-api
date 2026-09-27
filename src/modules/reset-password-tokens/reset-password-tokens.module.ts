import { Module } from "../../core";
import { ResetPasswordTokens } from "./reset-password-tokens.entity";
import { ResetPasswordTokensRepository } from "./reset-password-tokens.repository";
import { ResetPasswordTokensService } from "./reset-password-tokens.service";

@Module({
  entities: [ResetPasswordTokens],
  providers: [ResetPasswordTokensRepository, ResetPasswordTokensService],
})
export class ResetPasswordTokensModule {}
