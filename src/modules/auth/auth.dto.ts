import { ITokensDto } from "../../core";
import { IDeviceInfo } from "../session/session.types";
import { UserDto } from "../user/dto";

export { IDeviceInfo };

export interface IUserResetPasswordRequestDto {
  /** Токен из письма сброса пароля */
  token: string;
  /** Новый пароль: от 8 символов, не email, не из списка частых */
  password: string;
}

export interface IRefreshRequestDto {
  /** Refresh-токен; без него берётся из cookie `refresh_token` (если включена). */
  refreshToken?: string;
}

export interface IUserWithTokensDto extends UserDto {
  tokens: ITokensDto;
}

export interface IUserLoginRequestDto {
  /** Может быть телефоном, email-ом и username-ом  */
  login: string;
}

export interface ISignInRequestDto extends IUserLoginRequestDto {
  password: string;
}

export interface IAuthenticateRequestDto {
  code: string;
}

export interface I2FARequiredDto {
  require2FA: true;
  twoFactorToken: string;
  twoFactorHint?: string;
}

export interface IEnable2FARequestDto {
  /** Текущий пароль аккаунта */
  currentPassword: string;
  /** Пароль второго фактора */
  password: string;
  hint?: string;
}

export interface IVerify2FARequestDto {
  twoFactorToken: string;
  password: string;
}

export interface IDisable2FARequestDto {
  /** Текущий пароль аккаунта */
  currentPassword: string;
  /** Пароль второго фактора */
  password: string;
}

export type ISignInResponseDto = IUserWithTokensDto | I2FARequiredDto;

export type TSignUpRequestDto = {
  firstName?: string;
  lastName?: string;
  password: string;
} & (
  | {
      email?: string;
      phone: string;
    }
  | {
      email: string;
      phone?: string;
    }
);
