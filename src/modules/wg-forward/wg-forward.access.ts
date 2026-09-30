import { OwnedAccess } from "../../core";
import type { WgForward } from "./wg-forward.entity";

/** Свой проброс — где пользователь назначенный владелец или создатель. */
export const WgForwardAccess = new OwnedAccess<WgForward>({
  owner: "ownerId",
  creator: "createdById",
});
