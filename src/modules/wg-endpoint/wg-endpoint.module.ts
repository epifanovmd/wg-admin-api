import { Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import { WgEndpointController } from "./wg-endpoint.controller";
import { WgEndpoint } from "./wg-endpoint.entity";
import { WgEndpointListener } from "./wg-endpoint.listener";
import { WgEndpointRepository } from "./wg-endpoint.repository";
import { WgEndpointService } from "./wg-endpoint.service";
import { WgEndpointsRoomPolicy } from "./wg-endpoint-room.policy";
import { WgRelayLink } from "./wg-relay-link.entity";
import { WgRelayLinkRepository } from "./wg-relay-link.repository";

@Module({
  entities: [WgEndpoint, WgRelayLink],
  providers: [
    WgEndpointRepository,
    WgRelayLinkRepository,
    WgEndpointService,
    WgEndpointController,
    asSocketRoomPolicy(WgEndpointsRoomPolicy),
    asSocketListener(WgEndpointListener),
  ],
})
export class WgEndpointModule {}
