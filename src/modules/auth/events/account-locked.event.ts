import type { IAuthRequestMeta } from "../auth.types";

/** Вход в аккаунт заблокирован после серии неудач. */
export class AccountLockedEvent {
  constructor(
    public readonly userId: string | null,
    public readonly login: string,
    public readonly until: Date,
    public readonly request: IAuthRequestMeta = {},
  ) {}
}
