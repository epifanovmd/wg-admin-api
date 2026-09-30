import { OwnedAccess } from "../../core";
import type { WgNode } from "./wg-node.entity";

/** Своя нода — где пользователь назначенный владелец или создатель. */
export const WgNodeAccess = new OwnedAccess<WgNode>({
  owner: "ownerId",
  creator: "createdById",
});
