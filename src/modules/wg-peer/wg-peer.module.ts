import { asJobHandler, Module } from "../../core";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { WgPeerExpiryJob } from "./peer-expiry.job";
import { WgPeerController } from "./wg-peer.controller";
import { WgPeer } from "./wg-peer.entity";
import { WG_PEERS_ROOM, WgPeerListener } from "./wg-peer.listener";
import { WgPeerPermissions } from "./wg-peer.permissions";
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
    asSocketRoomPolicy(
      permissionRoomPolicy(WG_PEERS_ROOM, WgPeerPermissions.PEER_VIEW),
    ),
    asSocketListener(WgPeerListener),
    asJobHandler(WgPeerExpiryJob),
  ],
})
export class WgPeerModule {}
