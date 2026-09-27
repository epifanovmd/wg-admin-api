import type { IAuthRequestMeta } from "../auth.types";

export class TwoFactorEnabledEvent {
  constructor(
    public readonly userId: string,
    public readonly request: IAuthRequestMeta = {},
  ) {}
}

export class TwoFactorDisabledEvent {
  constructor(
    public readonly userId: string,
    public readonly request: IAuthRequestMeta = {},
  ) {}
}
