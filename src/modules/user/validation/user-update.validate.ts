import { z } from "zod";

import { normalizePhone, PHONE_RE } from "../../../common";

export const UserUpdateSchema = z
  .object({
    email: z
      .email("Неверный формат email")
      .max(50, "Email не должен превышать 50 символов")
      .transform(val => val.trim().toLowerCase())
      .optional(),

    phone: z
      .string()
      .transform(normalizePhone)
      .refine(val => PHONE_RE.test(val), {
        message: "Телефон должен быть в формате +7XXXXXXXXXX или 8XXXXXXXXXX",
      })
      .optional(),
  })
  .refine(data => data.email || data.phone, {
    message: "Должно быть указано хотя бы одно поле для обновления",
    path: ["general"],
  });
