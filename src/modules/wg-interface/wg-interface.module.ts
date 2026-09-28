import { Module } from "../../core";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { asWgEndpointUsage } from "../wg-endpoint";
import { WgInterfaceController } from "./wg-interface.controller";
import { WgInterface } from "./wg-interface.entity";
import { WgInterfaceGuard } from "./wg-interface.guard";
import {
  WG_INTERFACES_ROOM,
  WgInterfaceListener,
} from "./wg-interface.listener";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { WgInterfaceService } from "./wg-interface.service";
import { WgInterfaceEndpointUsage } from "./wg-interface-endpoint-usage";
import { WgInterfaceReplica } from "./wg-interface-replica.entity";
import { WgInterfaceReplicaRepository } from "./wg-interface-replica.repository";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";
import { WgInterfaceRoomPolicy } from "./wg-interface-room.policy";
import { WgRelaySyncService } from "./wg-relay-sync.service";

@Module({
  entities: [WgInterface, WgInterfaceReplica],
  providers: [
    WgInterfaceRepository,
    WgInterfaceReplicaRepository,
    WgRelaySyncService,
    WgInterfaceGuard,
    WgInterfaceReplicaService,
    WgInterfaceService,
    WgInterfaceController,
    asSocketRoomPolicy(WgInterfaceRoomPolicy),
    asSocketRoomPolicy(
      permissionRoomPolicy(
        WG_INTERFACES_ROOM,
        WgInterfacePermissions.INTERFACE_VIEW,
      ),
    ),
    asSocketListener(WgInterfaceListener),
    asWgEndpointUsage(WgInterfaceEndpointUsage),
  ],
})
export class WgInterfaceModule {}
