/**
 * WebAuthn-структуры в JSON-виде для OpenAPI. Совпадают по форме с типами
 * `@simplewebauthn/server`, но без DOM-типов (`BufferSource`), которые tsoa не
 * разбирает: всё бинарное передаётся строками Base64URL.
 */

/** Строка в кодировке Base64URL. */
export type Base64URLString = string;

/** Идентификатор алгоритма COSE (-7 — ES256, -257 — RS256). */
export type COSEAlgorithmIdentifier = number;

export type PublicKeyCredentialType = "public-key";

export type AuthenticatorTransportFuture =
  "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

export type AuthenticatorAttachment = "cross-platform" | "platform";

export type ResidentKeyRequirement = "discouraged" | "preferred" | "required";

export type UserVerificationRequirement =
  "discouraged" | "preferred" | "required";

export type AttestationConveyancePreference =
  "direct" | "enterprise" | "indirect" | "none";

export interface PublicKeyCredentialRpEntity {
  name: string;
  id?: string;
}

export interface PublicKeyCredentialUserEntityJSON {
  id: string;
  name: string;
  displayName: string;
}

export interface PublicKeyCredentialParameters {
  alg: COSEAlgorithmIdentifier;
  type: PublicKeyCredentialType;
}

export interface PublicKeyCredentialDescriptorJSON {
  id: Base64URLString;
  /** Всегда `public-key`; строкой — чтобы новые типы не ломали контракт. */
  type: string;
  /** Транспорты из `AuthenticatorTransportFuture` и будущие значения. */
  transports?: string[];
}

export interface AuthenticatorSelectionCriteria {
  authenticatorAttachment?: AuthenticatorAttachment;
  requireResidentKey?: boolean;
  residentKey?: ResidentKeyRequirement;
  userVerification?: UserVerificationRequirement;
}

/** Расширения, которые сервер запрашивает у аутентификатора. */
export interface AuthenticationExtensionsClientInputs {
  appid?: string;
  credProps?: boolean;
  hmacCreateSecret?: boolean;
  minPinLength?: boolean;
}

export interface CredentialPropertiesOutput {
  rk?: boolean;
}

/** Результаты расширений от аутентификатора. */
export interface AuthenticationExtensionsClientOutputs {
  appid?: boolean;
  credProps?: CredentialPropertiesOutput;
  hmacCreateSecret?: boolean;
}

/** Опции для `navigator.credentials.create()`. */
export interface PublicKeyCredentialCreationOptionsJSON {
  rp: PublicKeyCredentialRpEntity;
  user: PublicKeyCredentialUserEntityJSON;
  challenge: Base64URLString;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  hints?: string[];
  attestation?: AttestationConveyancePreference;
  attestationFormats?: string[];
  extensions?: AuthenticationExtensionsClientInputs;
}

/** Опции для `navigator.credentials.get()`. */
export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
  hints?: string[];
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface AuthenticatorAttestationResponseJSON {
  clientDataJSON: Base64URLString;
  attestationObject: Base64URLString;
  authenticatorData?: Base64URLString;
  transports?: AuthenticatorTransportFuture[];
  publicKeyAlgorithm?: COSEAlgorithmIdentifier;
  publicKey?: Base64URLString;
}

/** Ответ браузера на регистрацию passkey. */
export interface RegistrationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  response: AuthenticatorAttestationResponseJSON;
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  type: PublicKeyCredentialType;
}

export interface AuthenticatorAssertionResponseJSON {
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
  userHandle?: Base64URLString;
}

/** Ответ браузера на вход по passkey. */
export interface AuthenticationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  response: AuthenticatorAssertionResponseJSON;
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  type: PublicKeyCredentialType;
}
