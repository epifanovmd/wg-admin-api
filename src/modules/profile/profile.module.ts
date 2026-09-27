import { Module } from "../../core";
import { asSocketListener } from "../socket";
import { ProfileController } from "./profile.controller";
import { Profile } from "./profile.entity";
import { ProfileListener } from "./profile.listener";
import { ProfileRepository } from "./profile.repository";
import { ProfileService } from "./profile.service";

@Module({
  entities: [Profile],
  providers: [
    ProfileRepository,
    ProfileController,
    ProfileService,
    asSocketListener(ProfileListener),
  ],
})
export class ProfileModule {}
