import { asJobHandler, Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import { WgPeerExpiryJob } from "./peer-expiry.job";
import { WgPeerController } from "./wg-peer.controller";
import { WgPeer } from "./wg-peer.entity";
import { WgPeerListener } from "./wg-peer.listener";
import { WgPeerRepository } from "./wg-peer.repository";
import { WgPeerService } from "./wg-peer.service";
import { WgOwnPeersRoomPolicy, WgPeerRoomPolicy } from "./wg-peer-room.policy";

@Module({
  entities: [WgPeer],
  providers: [
    WgPeerRepository,
    WgPeerService,
    WgPeerController,
    asSocketRoomPolicy(WgPeerRoomPolicy),
    asSocketRoomPolicy(WgOwnPeersRoomPolicy),
    asSocketListener(WgPeerListener),
    asJobHandler(WgPeerExpiryJob),
  ],
})
export class WgPeerModule {}
