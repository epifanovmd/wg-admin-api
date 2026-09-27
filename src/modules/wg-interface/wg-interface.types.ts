/** Фактическое состояние интерфейса, о котором сообщил агент. */
export enum EWgInterfaceStatus {
  Up = "up",
  Down = "down",
  Error = "error",
  Unknown = "unknown",
}

/** Имя интерфейса Linux: до 15 символов, без пробелов и слэшей. */
export const WG_IFACE_NAME_RE = /^[a-zA-Z0-9_=+.-]{1,15}$/;

export const WG_IFACE_NAME_MAX = 15;
export const WG_IFACE_DNS_MAX = 255;
export const WG_IFACE_HOOK_MAX = 2000;
