import type { Session } from "../../session/session.entity";
import type { IAuthRequestMeta, TLoginMethod } from "../auth.types";

export class UserLoggedInEvent {
  constructor(
    public readonly userId: string,
    public readonly sessionId?: string,
    public readonly session?: Session,
    public readonly method: TLoginMethod = "password",
    public readonly request: IAuthRequestMeta = {},
  ) {}
}
