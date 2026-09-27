/**
 * Клиентский конфиг WireGuard. Все значения проходят Zod-валидацию на входе
 * (адреса, DNS, CIDR-списки), поэтому инъекция строк в конфиг невозможна.
 */
export interface IWgClientConfigInput {
  privateKey: string;
  addressV4: string;
  addressV6: string | null;
  dns: string | null;
  mtu: number | null;
  serverPublicKey: string;
  presharedKey: string | null;
  allowedIPs: string;
  /** `host:port` точки подключения. */
  endpoint: string;
  persistentKeepalive: number;
}

export const buildWgClientConfig = (input: IWgClientConfigInput): string => {
  const address = [
    `${input.addressV4}/32`,
    ...(input.addressV6 ? [`${input.addressV6}/128`] : []),
  ].join(", ");

  const lines = [
    "[Interface]",
    `PrivateKey = ${input.privateKey}`,
    `Address = ${address}`,
    ...(input.dns ? [`DNS = ${input.dns}`] : []),
    ...(input.mtu ? [`MTU = ${input.mtu}`] : []),
    "",
    "[Peer]",
    `PublicKey = ${input.serverPublicKey}`,
    ...(input.presharedKey ? [`PresharedKey = ${input.presharedKey}`] : []),
    `AllowedIPs = ${input.allowedIPs}`,
    `Endpoint = ${input.endpoint}`,
    `PersistentKeepalive = ${input.persistentKeepalive}`,
    "",
  ];

  return lines.join("\n");
};

/** Имя файла конфига: только безопасные символы, до 15 знаков основы. */
export const wgConfigFileName = (peerName: string): string => {
  const base = peerName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 15);

  return `${base || "wg"}.conf`;
};
