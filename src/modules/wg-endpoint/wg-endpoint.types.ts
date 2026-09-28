/** Режим точки подключения. */
export enum EWgEndpointMode {
  /** Хост указывает на ноду напрямую (стабильный DNS/IP, без релея). */
  Direct = "direct",
  /** Хост обслуживает релей-нода: агент настраивает проброс до целевой ноды. */
  Relay = "relay",
}

/** Как релей гонит трафик до целевой ноды. */
export enum EWgForwardMode {
  /** iptables DNAT на публичный адрес целевой ноды. */
  Dnat = "dnat",
  /** IPIP-туннель до целевой ноды, DNAT внутрь туннеля (обход потерь UDP). */
  Ipip = "ipip",
}

/**
 * Маршрут пересылки через IPIP-туннель: с запасным прямым путём до той же
 * ноды или без него. При DNAT не используется — туннеля нет.
 */
export enum EWgEndpointRoute {
  /** Туннель; не отвечает — напрямую на ту же ноду, затем — на копии. */
  Auto = "auto",
  /** Только туннель: при его отказе — сразу на копии интерфейса. */
  Tunnel = "tunnel",
  /** Принудительно напрямую, мимо туннеля. */
  Direct = "direct",
}

export const WG_ENDPOINT_NAME_MAX = 120;
export const WG_ENDPOINT_DESCRIPTION_MAX = 2000;

/** Имя IPIP-интерфейса туннеля по индексу линка. */
export const relayTunnelName = (tunnelIndex: number): string =>
  `wgt${tunnelIndex}`;
