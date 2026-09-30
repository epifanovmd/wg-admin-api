import { OwnedAccess } from "../../core";
import type { WgSocksService } from "./wg-socks.entity";

/** Свой прокси — где пользователь назначенный владелец или создатель. */
export const WgSocksAccess = new OwnedAccess<WgSocksService>({
  owner: "ownerId",
  creator: "createdById",
});
