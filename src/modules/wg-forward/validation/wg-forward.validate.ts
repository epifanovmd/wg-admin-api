import { z } from "zod";

import { wgHostSchema, wgPortSchema } from "../../wg-node";
import {
  EWgForwardPath,
  EWgForwardProtocol,
  EWgForwardRoute,
  WG_FORWARD_DESCRIPTION_MAX,
  WG_FORWARD_NAME_MAX,
} from "../wg-forward.types";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(
    WG_FORWARD_NAME_MAX,
    `Название — не длиннее ${WG_FORWARD_NAME_MAX} символов`,
  );

const description = z
  .string()
  .trim()
  .max(
    WG_FORWARD_DESCRIPTION_MAX,
    `Описание — не длиннее ${WG_FORWARD_DESCRIPTION_MAX} символов`,
  )
  .nullable();

const fields = {
  description: description.optional(),
  listenPort: wgPortSchema,
  targetNodeId: z.uuid().nullable().optional(),
  targetHost: wgHostSchema.nullable().optional(),
  targetPort: wgPortSchema,
  path: z.enum(EWgForwardPath),
  route: z.enum(EWgForwardRoute).optional(),
  enabled: z.boolean().optional(),
};

export const CreateWgForwardSchema = z.object({
  ...fields,
  name,
  relayNodeId: z.uuid(),
  protocol: z.enum(EWgForwardProtocol),
});

export const UpdateWgForwardSchema = z
  .object({
    name: name.optional(),
    description: fields.description,
    listenPort: fields.listenPort.optional(),
    targetNodeId: fields.targetNodeId,
    targetHost: fields.targetHost,
    targetPort: fields.targetPort.optional(),
    path: fields.path.optional(),
    route: fields.route,
    enabled: fields.enabled,
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });
