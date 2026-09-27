import { z } from "zod";

import {
  allowedIpsListSchema,
  dnsListSchema,
  wgKeySchema,
} from "../../wg-node";
import { WG_PEER_DESCRIPTION_MAX, WG_PEER_NAME_MAX } from "../wg-peer.types";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(WG_PEER_NAME_MAX, `Название — не длиннее ${WG_PEER_NAME_MAX} символов`);

const description = z
  .string()
  .trim()
  .max(
    WG_PEER_DESCRIPTION_MAX,
    `Описание — не длиннее ${WG_PEER_DESCRIPTION_MAX} символов`,
  )
  .nullable();

const keepalive = z.number().int().min(0).max(3600);
const clientMtu = z.number().int().min(1280).max(9000);
const expiresAt = z.coerce.date();

export const CreateWgPeerSchema = z.object({
  interfaceId: z.uuid(),
  name,
  description: description.optional(),
  userId: z.uuid().nullable().optional(),
  publicKey: wgKeySchema.nullable().optional(),
  withPresharedKey: z.boolean().optional(),
  clientAllowedIPs: allowedIpsListSchema.optional(),
  clientDns: dnsListSchema.nullable().optional(),
  clientMtu: clientMtu.nullable().optional(),
  persistentKeepalive: keepalive.optional(),
  expiresAt: expiresAt.nullable().optional(),
  enabled: z.boolean().optional(),
});

export const UpdateWgPeerSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    clientAllowedIPs: allowedIpsListSchema.optional(),
    clientDns: dnsListSchema.nullable().optional(),
    clientMtu: clientMtu.nullable().optional(),
    persistentKeepalive: keepalive.optional(),
    expiresAt: expiresAt.nullable().optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });

export const AssignWgPeerSchema = z.object({
  userId: z.uuid(),
});
