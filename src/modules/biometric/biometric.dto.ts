import { ITokensDto } from "../../core";

export interface IRegisterBiometricRequestDto {
  deviceId: string;
  deviceName: string;
  /** Публичный ключ устройства (SPKI DER в base64) */
  publicKey: string;
}

export interface IRegisterBiometricResponseDto {
  registered: boolean;
}

export interface IGenerateNonceRequestDto {
  userId: string;
  deviceId: string;
}

export interface IGenerateNonceResponseDto {
  nonce: string;
}

export interface IVerifyBiometricSignatureRequestDto {
  userId: string;
  deviceId: string;
  /** Nonce, выданный generate-nonce */
  nonce: string;
  /** Подпись nonce приватным ключом устройства (RSA-SHA256, base64) */
  signature: string;
}

export interface IVerifyBiometricSignatureResponseDto {
  verified: boolean;
  tokens: ITokensDto;
}

export interface IBiometricDeviceDto {
  id: string;
  deviceId: string;
  deviceName: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface IBiometricDevicesResponseDto {
  devices: IBiometricDeviceDto[];
}
