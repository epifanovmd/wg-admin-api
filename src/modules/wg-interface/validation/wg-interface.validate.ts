import { z } from "zod";

import { dnsListSchema, ipv4CidrSchema, wgPortSchema } from "../../wg-node";
import { WG_IFACE_HOOK_MAX, WG_IFACE_NAME_RE } from "../wg-interface.types";

const name = z
  .string()
  .trim()
  .regex(
    WG_IFACE_NAME_RE,
    "Имя интерфейса — до 15 символов: буквы, цифры, `_ = + . -`",
  );

const ipv6Cidr = z
  .string()
  .trim()
  .max(64)
  .refine(value => {
    const [ip, prefixRaw, rest] = value.split("/");
    const prefix = Number(prefixRaw);

    return (
      rest === undefined &&
      /^[0-9a-f:]{2,45}$/i.test(ip) &&
      ip.includes(":") &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= 128
    );
  }, "Ожидается IPv6 CIDR, например fd00:10::1/64");

const mtu = z.number().int().min(1280).max(9000);

const hook = z
  .string()
  .trim()
  .max(WG_IFACE_HOOK_MAX, `Хук — не длиннее ${WG_IFACE_HOOK_MAX} символов`)
  .nullable();

export const CreateWgInterfaceSchema = z.object({
  nodeId: z.uuid(),
  name,
  listenPort: wgPortSchema,
  addressCidr: ipv4CidrSchema,
  addressV6Cidr: ipv6Cidr.nullable().optional(),
  dns: dnsListSchema.nullable().optional(),
  mtu: mtu.nullable().optional(),
  endpointId: z.uuid().nullable().optional(),
  endpointPort: wgPortSchema.nullable().optional(),
  natEnabled: z.boolean().optional(),
  customPostUp: hook.optional(),
  customPostDown: hook.optional(),
  enabled: z.boolean().optional(),
  ownerId: z.uuid().nullable().optional(),
});

export const UpdateWgInterfaceSchema = z
  .object({
    name: name.optional(),
    listenPort: wgPortSchema.optional(),
    addressCidr: ipv4CidrSchema.optional(),
    addressV6Cidr: ipv6Cidr.nullable().optional(),
    dns: dnsListSchema.nullable().optional(),
    mtu: mtu.nullable().optional(),
    endpointId: z.uuid().nullable().optional(),
    endpointPort: wgPortSchema.nullable().optional(),
    natEnabled: z.boolean().optional(),
    customPostUp: hook.optional(),
    customPostDown: hook.optional(),
    activeReplicaNodeId: z.uuid().nullable().optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });

export const MoveWgInterfaceSchema = z.object({
  nodeId: z.uuid(),
});

export const AddWgInterfaceReplicaSchema = z.object({
  nodeId: z.uuid(),
});

export const AssignWgInterfaceSchema = z.object({
  userId: z.uuid(),
});
