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

export const WG_ENDPOINT_NAME_MAX = 120;
export const WG_ENDPOINT_DESCRIPTION_MAX = 2000;

/** Имя IPIP-интерфейса туннеля по индексу линка. */
export const relayTunnelName = (tunnelIndex: number): string =>
  `wgt${tunnelIndex}`;
