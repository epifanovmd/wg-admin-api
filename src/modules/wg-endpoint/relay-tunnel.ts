import { intToIpv4, parseIpv4Cidr } from "../wg-node";

export interface IRelayTunnelAddresses {
  /** Адрес конца туннеля на релее. */
  relayIp: string;
  /** Адрес конца туннеля на целевой ноде. */
  targetIp: string;
  prefix: number;
}

/** Сколько /30-блоков помещается в базовой подсети туннелей. */
export const relayTunnelCapacity = (baseCidr: string): number => {
  const base = parseIpv4Cidr(baseCidr);

  return Math.floor((base.broadcast - base.network + 1) / 4);
};

/** Адреса концов IPIP-туннеля для /30-блока с данным индексом. */
export const relayTunnelAddresses = (
  baseCidr: string,
  tunnelIndex: number,
): IRelayTunnelAddresses => {
  const base = parseIpv4Cidr(baseCidr);
  const block = base.network + tunnelIndex * 4;

  if (tunnelIndex < 0 || block + 3 > base.broadcast) {
    throw new Error(
      `Индекс туннеля ${tunnelIndex} не помещается в ${baseCidr}`,
    );
  }

  return {
    relayIp: intToIpv4(block + 1),
    targetIp: intToIpv4(block + 2),
    prefix: 30,
  };
};
