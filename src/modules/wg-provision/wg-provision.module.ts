import { asJobAccessPolicy, asJobHandler, Module } from "../../core";
import { asSocketListener } from "../socket";
import { WgNodeJobAccessPolicy } from "./wg-node-job-access.policy";
import { WgProvisionController } from "./wg-provision.controller";
import { WgProvisionNodeJob } from "./wg-provision.job";
import { WgProvisionListener } from "./wg-provision.listener";
import { WgProvisionService } from "./wg-provision.service";
import { WgUninstallNodeJob } from "./wg-uninstall.job";

@Module({
  providers: [
    WgProvisionService,
    WgProvisionController,
    asJobHandler(WgProvisionNodeJob),
    asJobHandler(WgUninstallNodeJob),
    asJobAccessPolicy(WgNodeJobAccessPolicy),
    asSocketListener(WgProvisionListener),
  ],
})
export class WgProvisionModule {}
