import { Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import { asWgRelayConsumer } from "../wg-interface";
import { WgForwardController } from "./wg-forward.controller";
import { WgForward } from "./wg-forward.entity";
import { WgForwardListener } from "./wg-forward.listener";
import { WgForwardRepository } from "./wg-forward.repository";
import { WgForwardService } from "./wg-forward.service";
import { WgForwardRelayConsumer } from "./wg-forward-relay-consumer";
import { WgForwardsRoomPolicy } from "./wg-forward-room.policy";

@Module({
  entities: [WgForward],
  providers: [
    WgForwardRepository,
    WgForwardService,
    WgForwardController,
    asWgRelayConsumer(WgForwardRelayConsumer),
    asSocketRoomPolicy(WgForwardsRoomPolicy),
    asSocketListener(WgForwardListener),
  ],
})
export class WgForwardModule {}
