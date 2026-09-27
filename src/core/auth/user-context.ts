import { AuthContext, KoaRequest } from "../../types/koa";
import { UnauthorizedException } from "../http";
import { isSuperUserGrant } from "./has-permission";

export const getContextUser = (req: KoaRequest): AuthContext => {
  const user = req.ctx.request.user;

  if (!user) {
    throw new UnauthorizedException();
  }

  return user;
};

/** Суперпользователь: роль `SUPERUSER_ROLE` или право `ALL_PERMISSIONS`. */
export const isSuperUser = (user: AuthContext): boolean =>
  isSuperUserGrant(user.roles, user.permissions);

export interface IDeviceInfo {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
  deviceType?: string;
}

/** Откуда пришёл вход — для списка сессий. */
export const getDeviceInfo = (req: KoaRequest): IDeviceInfo => ({
  ip: req.ctx?.request?.ip,
  userAgent: req.ctx?.request?.headers?.["user-agent"],
  deviceName: req.ctx?.request?.headers?.["x-device-name"] as
    string | undefined,
  deviceType: req.ctx?.request?.headers?.["x-device-type"] as
    string | undefined,
});
