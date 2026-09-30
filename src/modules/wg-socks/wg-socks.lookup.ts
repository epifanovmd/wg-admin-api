import type { AuthContext } from "../../types/koa";
import { WgSocksAccess } from "./wg-socks.access";
import type { WgSocksService } from "./wg-socks.entity";
import { WgSocksError } from "./wg-socks.errors";
import { WgSocksPermissions } from "./wg-socks.permissions";
import type { WgSocksServiceRepository } from "./wg-socks.repository";

/**
 * Прокси со связями для действия актора: невидимый — 404, видимый без права
 * на действие — 403.
 */
export const findSocksFor = async (
  repo: WgSocksServiceRepository,
  actor: AuthContext,
  id: string,
  permission: string,
): Promise<WgSocksService> => {
  const service = await repo.findWithRelations(id);

  if (
    !service ||
    !WgSocksAccess.can(actor, WgSocksPermissions.SOCKS_VIEW, service)
  ) {
    throw WgSocksError.NOT_FOUND();
  }
  if (!WgSocksAccess.can(actor, permission, service)) {
    throw WgSocksError.FORBIDDEN();
  }

  return service;
};
