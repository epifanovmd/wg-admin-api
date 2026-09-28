import { asJobHandler, Module } from "../../core";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import {
  WgCommandRetentionJob,
  WgCommandTimeoutJob,
} from "./command-maintenance.jobs";
import { WgNodeOfflineJob } from "./node-offline.job";
import { WgNodeController } from "./wg-node.controller";
import { WgNode } from "./wg-node.entity";
import { WG_NODES_ROOM, WgNodeListener } from "./wg-node.listener";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeRepository } from "./wg-node.repository";
import { WgNodeService } from "./wg-node.service";
import { WgNodeCommand } from "./wg-node-command.entity";
import { WgNodeCommandRepository } from "./wg-node-command.repository";
import { WgNodeCommandService } from "./wg-node-command.service";
import { WgNodeRoomPolicy } from "./wg-node-room.policy";
import { WgSecretBox } from "./wg-secret-box.service";

@Module({
  entities: [WgNode, WgNodeCommand],
  providers: [
    WgNodeRepository,
    WgNodeCommandRepository,
    WgSecretBox,
    WgNodeService,
    WgNodeCommandService,
    WgNodeController,
    asSocketRoomPolicy(WgNodeRoomPolicy),
    asSocketRoomPolicy(
      permissionRoomPolicy(WG_NODES_ROOM, WgNodePermissions.NODE_VIEW),
    ),
    asSocketListener(WgNodeListener),
    asJobHandler(WgNodeOfflineJob),
    asJobHandler(WgCommandTimeoutJob),
    asJobHandler(WgCommandRetentionJob),
  ],
})
export class WgNodeModule {}
