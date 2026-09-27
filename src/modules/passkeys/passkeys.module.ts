import { asJobHandler, Module } from "../../core";
import { Passkey } from "./passkey.entity";
import { PasskeyChallenge } from "./passkey-challenge.entity";
import { PasskeyChallengeRepository } from "./passkey-challenge.repository";
import { PasskeyChallengeCleanupJob } from "./passkey-challenge-cleanup.job";
import { PasskeysController } from "./passkeys.controller";
import { PasskeysRepository } from "./passkeys.repository";
import { PasskeysService } from "./passkeys.service";

@Module({
  entities: [Passkey, PasskeyChallenge],
  providers: [
    PasskeysRepository,
    PasskeyChallengeRepository,
    PasskeysService,
    PasskeysController,
    asJobHandler(PasskeyChallengeCleanupJob),
  ],
})
export class PasskeysModule {}
