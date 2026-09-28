import { asJobHandler, Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import {
  WgCommandRetentionJob,
  WgCommandTimeoutJob,
} from "./command-maintenance.jobs";
import { WgNodeOfflineJob } from "./node-offline.job";
import { WgNodeController } from "./wg-node.controller";
import { WgNode } from "./wg-node.entity";
import { WgNodeListener } from "./wg-node.listener";
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
    asSocketListener(WgNodeListener),
    asJobHandler(WgNodeOfflineJob),
    asJobHandler(WgCommandTimeoutJob),
    asJobHandler(WgCommandRetentionJob),
  ],
})
export class WgNodeModule {}
