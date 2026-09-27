import os from "os";

export interface IDocsServer {
  url: string;
  description: string;
}

export interface IDocsServersOptions {
  port: number;
  /** Origin, с которого открыта документация: запросы на него не упираются в CORS. */
  origin?: string;
  /** Публичный URL API (`APP_PUBLIC_URL`). */
  publicUrl?: string;
  /** Дополнительные адреса из конфига (`API_DOCS_SERVERS`). */
  extra?: string[];
  interfaces?: ReturnType<typeof os.networkInterfaces>;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** Внешние IPv4 машины — по ним API доступен из локальной сети. */
const lanAddresses = (
  interfaces: ReturnType<typeof os.networkInterfaces>,
): string[] =>
  Object.values(interfaces)
    .flatMap(list => list ?? [])
    .filter(info => info.family === "IPv4" && !info.internal)
    .map(info => info.address);

/**
 * Список `servers` для Swagger: текущий origin, localhost, IP машины, публичный
 * URL и адреса из конфига. Строится на каждый запрос — IP в сети может смениться.
 */
export const buildDocsServers = ({
  port,
  origin,
  publicUrl,
  extra = [],
  interfaces = os.networkInterfaces(),
}: IDocsServersOptions): IDocsServer[] => {
  const candidates: IDocsServer[] = [
    ...(origin ? [{ url: origin, description: "Current" }] : []),
    { url: `http://localhost:${port}`, description: "Localhost" },
    ...lanAddresses(interfaces).map(ip => ({
      url: `http://${ip}:${port}`,
      description: "Local network",
    })),
    ...(publicUrl ? [{ url: publicUrl, description: "Public URL" }] : []),
    ...extra.map(url => ({ url, description: "Remote" })),
  ];

  const seen = new Set<string>();

  return candidates
    .map(server => ({ ...server, url: trimSlash(server.url) }))
    .filter(server => {
      if (seen.has(server.url)) return false;
      seen.add(server.url);

      return true;
    });
};
