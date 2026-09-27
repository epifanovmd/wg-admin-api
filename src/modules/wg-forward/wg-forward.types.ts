/** Максимальная длина названия — совпадает с колонкой `name`. */
export const WG_FORWARD_NAME_MAX = 120;
/** Максимальная длина описания. */
export const WG_FORWARD_DESCRIPTION_MAX = 2000;
/** Внешний адрес цели — совпадает с колонкой `target_host`. */
export const WG_FORWARD_HOST_MAX = 255;

export enum EWgForwardProtocol {
  Udp = "udp",
  Tcp = "tcp",
}

/** Путь до цели: напрямую (DNAT на её адрес) или через IPIP-туннель. */
export enum EWgForwardPath {
  Direct = "direct",
  Ipip = "ipip",
}

/**
 * Маршрут пути `ipip`: `auto` — туннель, а если он не отвечает, напрямую;
 * `tunnel` / `direct` — принудительно.
 */
export enum EWgForwardRoute {
  Auto = "auto",
  Tunnel = "tunnel",
  Direct = "direct",
}

/** Активный маршрут проброса по отчёту агента релея. */
export enum EWgForwardActiveRoute {
  Tunnel = "tunnel",
  Direct = "direct",
}
