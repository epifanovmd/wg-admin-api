import type { IAuthRequestMeta } from "../auth.types";

/** Почему вход не удался. */
export type TLoginFailureReason =
  "invalid-credentials" | "invalid-2fa" | "locked";

/**
 * Неудачный вход. `userId` — если логин принадлежит существующему
 * пользователю (для журнала его безопасности), `login` — как введён.
 */
export class LoginFailedEvent {
  constructor(
    public readonly userId: string | null,
    public readonly login: string,
    public readonly reason: TLoginFailureReason,
    public readonly request: IAuthRequestMeta = {},
  ) {}
}
