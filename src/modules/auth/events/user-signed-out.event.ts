import type { IAuthRequestMeta } from "../auth.types";

/** Пользователь вышел: из текущей сессии или из всех. */
export class UserSignedOutEvent {
  constructor(
    public readonly userId: string,
    public readonly sessionId: string,
    public readonly scope: "current" | "all",
    public readonly request: IAuthRequestMeta = {},
  ) {}
}
