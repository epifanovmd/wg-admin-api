import { z } from "zod";

const deviceId = z
  .string()
  .trim()
  .min(1, "Не указан идентификатор устройства")
  .max(100, "Идентификатор устройства не должен превышать 100 символов");

export const RegisterBiometricSchema = z.object({
  deviceId,
  deviceName: z
    .string()
    .trim()
    .min(1, "Не указано имя устройства")
    .max(100, "Имя устройства не должно превышать 100 символов"),
  publicKey: z
    .string()
    .min(1, "Не указан публичный ключ")
    .max(4096, "Публичный ключ не должен превышать 4096 символов"),
});

export const GenerateNonceSchema = z.object({
  userId: z.uuid("Неверный идентификатор пользователя"),
  deviceId,
});

export const VerifyBiometricSignatureSchema = z.object({
  userId: z.uuid("Неверный идентификатор пользователя"),
  deviceId,
  nonce: z
    .string()
    .min(1, "Не указан nonce")
    .max(64, "Nonce не должен превышать 64 символа"),
  signature: z
    .string()
    .min(1, "Не указана подпись")
    .max(2048, "Подпись не должна превышать 2048 символов"),
});
