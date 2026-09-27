import { z } from "zod";

import { wgHostSchema } from "../../wg-node";
import {
  EWgEndpointMode,
  EWgForwardMode,
  WG_ENDPOINT_DESCRIPTION_MAX,
  WG_ENDPOINT_NAME_MAX,
} from "../wg-endpoint.types";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(
    WG_ENDPOINT_NAME_MAX,
    `Название — не длиннее ${WG_ENDPOINT_NAME_MAX} символов`,
  );

const description = z
  .string()
  .trim()
  .max(
    WG_ENDPOINT_DESCRIPTION_MAX,
    `Описание — не длиннее ${WG_ENDPOINT_DESCRIPTION_MAX} символов`,
  )
  .nullable();

const relayConsistent = (body: {
  mode?: EWgEndpointMode;
  relayNodeId?: string | null;
}): boolean => body.mode !== EWgEndpointMode.Relay || Boolean(body.relayNodeId);

export const CreateWgEndpointSchema = z
  .object({
    name,
    description: description.optional(),
    host: wgHostSchema,
    mode: z.enum(EWgEndpointMode),
    relayNodeId: z.uuid().nullable().optional(),
    forwardMode: z.enum(EWgForwardMode).optional(),
  })
  .refine(relayConsistent, {
    message: "Для режима relay нужна релей-нода",
    path: ["relayNodeId"],
  });

export const UpdateWgEndpointSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    host: wgHostSchema.optional(),
    mode: z.enum(EWgEndpointMode).optional(),
    relayNodeId: z.uuid().nullable().optional(),
    forwardMode: z.enum(EWgForwardMode).optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });
