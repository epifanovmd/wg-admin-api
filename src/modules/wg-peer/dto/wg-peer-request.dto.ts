export interface ICreateWgPeerBody {
  interfaceId: string;
  name: string;
  description?: string | null;
  /** Держатель пира. */
  userId?: string | null;
  /**
   * Импорт существующего клиента: его публичный ключ. Приватный ключ тогда
   * не хранится, конфиг/QR не создаются.
   */
  publicKey?: string | null;
  /** Создавать ли preshared-ключ (по умолчанию да). */
  withPresharedKey?: boolean;
  /** AllowedIPs клиента (split tunnel); по умолчанию весь трафик. */
  clientAllowedIPs?: string;
  clientDns?: string | null;
  clientMtu?: number | null;
  persistentKeepalive?: number;
  expiresAt?: Date | null;
  enabled?: boolean;
}

export interface IUpdateWgPeerBody {
  name?: string;
  description?: string | null;
  clientAllowedIPs?: string;
  clientDns?: string | null;
  clientMtu?: number | null;
  persistentKeepalive?: number;
  expiresAt?: Date | null;
}

export interface IAssignWgPeerBody {
  userId: string;
}
