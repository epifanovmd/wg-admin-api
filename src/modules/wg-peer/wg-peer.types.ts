/** Причина, по которой пир выключен. */
export enum EWgPeerDisabledReason {
  /** Выключен вручную. */
  Manual = "manual",
  /** Срок действия истёк (cron `wg.peer-expiry`). */
  Expired = "expired",
}

export const WG_PEER_NAME_MAX = 120;
export const WG_PEER_DESCRIPTION_MAX = 2000;
export const WG_PEER_DEFAULT_KEEPALIVE = 25;
export const WG_PEER_DEFAULT_CLIENT_ALLOWED_IPS = "0.0.0.0/0, ::/0";

/** Handshake свежее этого окна — пир считается онлайн. */
export const WG_PEER_ONLINE_WINDOW_SEC = 180;

export const isPeerOnline = (
  lastHandshakeAt: Date | null,
  now = Date.now(),
): boolean =>
  lastHandshakeAt !== null &&
  now - lastHandshakeAt.getTime() < WG_PEER_ONLINE_WINDOW_SEC * 1000;
