import { OwnedAccess } from "../../core";
import type { WgPeer } from "./wg-peer.entity";

/** Свой пир — где пользователь держатель или создатель. */
export const WgPeerAccess = new OwnedAccess<WgPeer>({
  owner: "userId",
  creator: "createdById",
});
