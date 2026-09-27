import { asJobHandler, Module } from "../../core";
import { asSocketListener } from "../socket";
import { SessionController } from "./session.controller";
import { Session } from "./session.entity";
import { SessionListener } from "./session.listener";
import { SessionRepository } from "./session.repository";
import { SessionService } from "./session.service";
import { SessionCleanupJob } from "./session-cleanup.job";

@Module({
  entities: [Session],
  providers: [
    SessionRepository,
    SessionService,
    SessionController,
    asSocketListener(SessionListener),
    asJobHandler(SessionCleanupJob),
  ],
})
export class SessionModule {}
