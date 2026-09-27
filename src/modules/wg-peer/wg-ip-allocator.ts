import { cidrContains, intToIpv4, ipv4ToInt, parseIpv4Cidr } from "../wg-node";

/**
 * Первый свободный IPv4-адрес в подсети интерфейса: пропускаются адрес сети,
 * broadcast, адрес самого интерфейса и занятые адреса. `null` — подсеть
 * исчерпана.
 */
export const allocatePeerIpv4 = (
  interfaceCidr: string,
  usedAddresses: string[],
): string | null => {
  const cidr = parseIpv4Cidr(interfaceCidr);
  const used = new Set(usedAddresses.map(ipv4ToInt));

  used.add(cidr.ip);

  for (
    let candidate = cidr.network + 1;
    candidate < cidr.broadcast;
    candidate += 1
  ) {
    if (!used.has(candidate)) return intToIpv4(candidate);
  }

  return null;
};

/**
 * IPv6-адрес пира из адреса интерфейса: host-часть — смещение IPv4-адреса
 * пира от адреса сети (стабильно и уникально в рамках интерфейса).
 * Форма адреса интерфейса сложнее `prefix::suffix` — IPv6 не выдаётся.
 */
export const derivePeerIpv6 = (
  interfaceV6Cidr: string | null,
  interfaceV4Cidr: string,
  peerV4: string,
): string | null => {
  if (!interfaceV6Cidr) return null;

  const [address] = interfaceV6Cidr.split("/");
  const doubleColon = address.indexOf("::");

  if (doubleColon === -1) return null;

  const prefix = address.slice(0, doubleColon);
  const v4 = parseIpv4Cidr(interfaceV4Cidr);
  const offset = ipv4ToInt(peerV4) - v4.network;

  if (!cidrContains(v4, ipv4ToInt(peerV4)) || offset <= 0) return null;

  return `${prefix}::${offset.toString(16)}`;
};
