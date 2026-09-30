import { OwnedAccess } from "../../core";
import type { WgInterface } from "./wg-interface.entity";

/** Свой интерфейс — где пользователь назначенный владелец или создатель. */
export const WgInterfaceAccess = new OwnedAccess<WgInterface>({
  owner: "ownerId",
  creator: "createdById",
});
