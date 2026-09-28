export interface IDeviceInfo {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
  deviceType?: string;
}

/** Почему сессия завершена — для клиента и журнала аудита. */
export type TSessionEndReason =
  | "sign-out"
  | "sign-out-all"
  | "terminated"
  | "others-terminated"
  | "evicted"
  | "expired"
  | "refresh-reuse"
  | "password-changed";
