import { z } from "zod";

import { WG_KEY_RE } from "../wg-keys";
import { WG_NODE_HOST_MAX } from "../wg-node.types";

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const IPV6_RE = /^[0-9a-f:]{2,45}$/i;

/** Хост: доменное имя, IPv4 или IPv6 — попадает в конфиги, поэтому строго. */
export const wgHostSchema = z
  .string()
  .trim()
  .max(WG_NODE_HOST_MAX, `Хост — не длиннее ${WG_NODE_HOST_MAX} символов`)
  .refine(value => {
    // Только цифры и точки — это IPv4, а не доменное имя.
    if (/^[\d.]+$/.test(value)) return IPV4_RE.test(value);
    if (value.includes(":")) return IPV6_RE.test(value);

    return HOSTNAME_RE.test(value);
  }, "Хост — доменное имя или IP-адрес");

export const wgPortSchema = z
  .number()
  .int("Порт — целое число")
  .min(1, "Порт — от 1")
  .max(65535, "Порт — до 65535");

/** Ключ WireGuard (32 байта base64). */
export const wgKeySchema = z
  .string()
  .regex(WG_KEY_RE, "Ключ WireGuard — 32 байта в base64");

/** IPv4 CIDR: адрес интерфейса с маской подсети, например `10.0.0.1/24`. */
export const ipv4CidrSchema = z
  .string()
  .trim()
  .refine(value => {
    const [ip, prefix, rest] = value.split("/");

    if (rest !== undefined || !prefix) return false;

    const bits = Number(prefix);

    return (
      IPV4_RE.test(ip) && Number.isInteger(bits) && bits >= 0 && bits <= 32
    );
  }, "Ожидается IPv4 CIDR, например 10.0.0.1/24");

/**
 * Список сетей для AllowedIPs клиента: IPv4/IPv6 CIDR через запятую.
 * Значение попадает в конфиг — только адреса, никаких произвольных строк.
 */
export const allowedIpsListSchema = z
  .string()
  .trim()
  .max(500)
  .refine(value => {
    const items = value.split(",").map(item => item.trim());

    return (
      items.length > 0 &&
      items.every(item => {
        const [ip, prefix, rest] = item.split("/");

        if (rest !== undefined) return false;
        if (item.includes(":")) {
          const bits = prefix === undefined ? 128 : Number(prefix);

          return (
            IPV6_RE.test(ip) &&
            Number.isInteger(bits) &&
            bits >= 0 &&
            bits <= 128
          );
        }

        const bits = prefix === undefined ? 32 : Number(prefix);

        return (
          IPV4_RE.test(ip) && Number.isInteger(bits) && bits >= 0 && bits <= 32
        );
      })
    );
  }, "Ожидается список CIDR через запятую, например 0.0.0.0/0, ::/0");

/** Список DNS-серверов через запятую (IP или домен для search-домена). */
export const dnsListSchema = z
  .string()
  .trim()
  .max(255)
  .refine(value => {
    const items = value.split(",").map(item => item.trim());

    return (
      items.length > 0 &&
      items.every(
        item =>
          IPV4_RE.test(item) || IPV6_RE.test(item) || HOSTNAME_RE.test(item),
      )
    );
  }, "Ожидается список DNS через запятую");
