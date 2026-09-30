import { inject } from "inversify";

import { IBootstrap, Injectable, logger, ownPermission } from "../../core";
import { PermissionRepository } from "../permission";
import { RoleRepository, Roles } from "../role";
import { WgPeerPermissions } from "../wg-peer";
import { WgStatsPermissions } from "./wg-stats.permissions";

/**
 * Засев базовых прав пользователя VPN: роль `user` видит свои пиры, их
 * конфиги и статистику и включает-выключает их. Идемпотентен.
 */
@Injectable()
export class WgSeedBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(RoleRepository) private readonly _roles: RoleRepository,
    @inject(PermissionRepository)
    private readonly _permissions: PermissionRepository,
  ) {}

  async initialize(): Promise<void> {
    try {
      const role = await this._roles.ensureByName(Roles.USER);
      const granted = await Promise.all(
        [
          WgPeerPermissions.PEER_VIEW,
          WgPeerPermissions.PEER_TOGGLE,
          WgStatsPermissions.STATS_VIEW,
        ].map(name => this._permissions.ensureByName(ownPermission(name))),
      );

      await this._roles.grantPermissionsIfMissing(
        role.id,
        granted.map(permission => permission.id),
      );
    } catch (err) {
      logger.error({ err }, "[WG] seed of user role permissions failed");
    }
  }
}
