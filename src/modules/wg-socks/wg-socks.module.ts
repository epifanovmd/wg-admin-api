import { Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import { asWgRelayConsumer } from "../wg-interface";
import { WgSocksController } from "./wg-socks.controller";
import { WgSocksClient, WgSocksService, WgSocksUser } from "./wg-socks.entity";
import { WgSocksListener } from "./wg-socks.listener";
import {
  WgSocksClientRepository,
  WgSocksServiceRepository,
  WgSocksUserRepository,
} from "./wg-socks.repository";
import { WgSocksAppService } from "./wg-socks.service";
import { WgSocksClientKitService } from "./wg-socks-client-kit.service";
import { WgSocksPortClaims } from "./wg-socks-port-claims";
import { WgSocksRoomPolicy } from "./wg-socks-room.policy";

@Module({
  entities: [WgSocksService, WgSocksUser, WgSocksClient],
  providers: [
    WgSocksServiceRepository,
    WgSocksUserRepository,
    WgSocksClientRepository,
    WgSocksAppService,
    WgSocksClientKitService,
    WgSocksController,
    asWgRelayConsumer(WgSocksPortClaims),
    asSocketRoomPolicy(WgSocksRoomPolicy),
    asSocketListener(WgSocksListener),
  ],
})
export class WgSocksModule {}
