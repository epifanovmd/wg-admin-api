import { OwnedAccess } from "../../core";
import type { WgEndpoint } from "./wg-endpoint.entity";

/** Своя точка подключения — где пользователь назначенный владелец или создатель. */
export const WgEndpointAccess = new OwnedAccess<WgEndpoint>({
  owner: "ownerId",
  creator: "createdById",
});
