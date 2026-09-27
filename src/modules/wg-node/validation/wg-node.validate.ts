import { z } from "zod";

import { WG_NODE_DESCRIPTION_MAX, WG_NODE_NAME_MAX } from "../wg-node.types";
import { wgHostSchema } from "./wg-shared.validate";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(WG_NODE_NAME_MAX, `Название — не длиннее ${WG_NODE_NAME_MAX} символов`);

const description = z
  .string()
  .trim()
  .max(
    WG_NODE_DESCRIPTION_MAX,
    `Описание — не длиннее ${WG_NODE_DESCRIPTION_MAX} символов`,
  )
  .nullable();

export const CreateWgNodeSchema = z.object({
  name,
  description: description.optional(),
  publicHost: wgHostSchema.nullable().optional(),
});

export const UpdateWgNodeSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    publicHost: wgHostSchema.nullable().optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });
