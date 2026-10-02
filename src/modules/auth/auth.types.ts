/** Способ входа: пароль, 2FA, passkey, биометрия, регистрация. */
export type TLoginMethod =
  "password" | "2fa" | "passkey" | "biometric" | "sign-up";

/** Откуда пришёл запрос — для аудита. */
export interface IAuthRequestMeta {
  ip?: string;
  userAgent?: string;
}
