/** Утилиты IPv4 WG-домена: разбор CIDR, выделение адресов. Только IPv4. */

export interface IParsedCidr {
  /** Адрес из записи CIDR (например, адрес интерфейса). */
  ip: number;
  /** Длина префикса. */
  prefix: number;
  /** Адрес сети. */
  network: number;
  /** Broadcast-адрес. */
  broadcast: number;
}

export const ipv4ToInt = (ip: string): number => {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new Error(`Некорректный IPv4-адрес: ${ip}`);
  }

  return (
    parts[0] * 0x1000000 + parts[1] * 0x10000 + parts[2] * 0x100 + parts[3]
  );
};

export const intToIpv4 = (value: number): string =>
  [
    Math.floor(value / 0x1000000) % 256,
    Math.floor(value / 0x10000) % 256,
    Math.floor(value / 0x100) % 256,
    value % 256,
  ].join(".");

export const parseIpv4Cidr = (cidr: string): IParsedCidr => {
  const [ip, prefixRaw, rest] = cidr.split("/");
  const prefix = Number(prefixRaw);

  if (
    rest !== undefined ||
    !prefixRaw ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    throw new Error(`Некорректный IPv4 CIDR: ${cidr}`);
  }

  const address = ipv4ToInt(ip);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(address / size) * size;

  return { ip: address, prefix, network, broadcast: network + size - 1 };
};

/** Адрес входит в подсеть CIDR. */
export const cidrContains = (cidr: IParsedCidr, ip: number): boolean =>
  ip >= cidr.network && ip <= cidr.broadcast;
