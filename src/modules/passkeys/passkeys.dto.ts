import { ITokensDto } from "../../core";
import { BaseDto } from "../../core/dto/BaseDto";
import { Passkey } from "./passkey.entity";
import {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "./webauthn.dto";

export interface IGenerateAuthenticationOptionsRequestDto {
  /** Email или телефон пользователя */
  login: string;
}

export interface IVerifyRegistrationRequestDto {
  data: RegistrationResponseJSON;
}

export interface IVerifyAuthenticationRequestDto {
  data: AuthenticationResponseJSON;
}

export interface IVerifyAuthenticationResponseDto {
  verified: boolean;
  tokens?: ITokensDto;
}

export interface IVerifyRegistrationResponseDto {
  verified: boolean;
}

/** Passkey пользователя — без ключа и счётчика. */
export class PasskeyDto extends BaseDto {
  /** Credential ID (Base64URL) */
  id: string;
  deviceType: string;
  transports: string[] | null;
  lastUsed: Date | null;
  createdAt: Date;

  constructor(entity: Passkey) {
    super(entity);

    this.id = entity.id;
    this.deviceType = entity.deviceType;
    this.transports = entity.transports ?? null;
    this.lastUsed = entity.lastUsed ?? null;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: Passkey) {
    return new PasskeyDto(entity);
  }
}
