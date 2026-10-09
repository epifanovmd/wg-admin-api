import { Module } from "../../core";
import { asAgentAccessPolicy } from "../agent";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { WgNodeController } from "./wg-node.controller";
import { WgNode } from "./wg-node.entity";
import { WG_NODES_ROOM, WgNodeListener } from "./wg-node.listener";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeRepository } from "./wg-node.repository";
import { WgNodeService } from "./wg-node.service";
import { WgNodeAgentListener } from "./wg-node-agent.listener";
import { WgNodeAgentService } from "./wg-node-agent.service";
import { WgNodeAgentAccessPolicy } from "./wg-node-agent-access.policy";
import { WgNodeRoomPolicy } from "./wg-node-room.policy";
import { WgSecretBox } from "./wg-secret-box.service";

@Module({
  entities: [WgNode],
  providers: [
    WgNodeRepository,
    WgSecretBox,
    WgNodeService,
    WgNodeAgentService,
    WgNodeController,
    asAgentAccessPolicy(WgNodeAgentAccessPolicy),
    asSocketRoomPolicy(WgNodeRoomPolicy),
    asSocketRoomPolicy(
      permissionRoomPolicy(WG_NODES_ROOM, WgNodePermissions.NODE_VIEW),
    ),
    asSocketListener(WgNodeListener),
    asSocketListener(WgNodeAgentListener),
  ],
})
export class WgNodeModule {}
