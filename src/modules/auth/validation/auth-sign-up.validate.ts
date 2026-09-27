import { z } from "zod";

import { normalizePhone, PHONE_RE } from "../../../common";
import { validatePasswordPolicy } from "../../../core";
import { accountPassword } from "./account-password";

export const SignUpSchema = z
  .object({
    password: accountPassword,
    firstName: z
      .string()
      .max(40, "Имя не должно превышать 40 символов")
      .optional(),
    lastName: z
      .string()
      .max(40, "Фамилия не должна превышать 40 символов")
      .optional(),
    email: z
      .email("Неверный формат email")
      .max(50, "Email не должен превышать 50 символов")
      .transform(val => val.trim().toLowerCase())
      .optional(),
    phone: z
      .string()
      .max(20, "Телефон не должен превышать 20 символов")
      .transform(normalizePhone)
      .pipe(
        z.string().regex(PHONE_RE, {
          message: "Телефон должен быть в формате +7XXXXXXXXXX или 8XXXXXXXXXX",
        }),
      )
      .optional(),
  })
  .refine(data => data.email || data.phone, {
    message: "Необходимо указать email или телефон",
    path: ["email"],
  })
  .superRefine((data, ctx) => {
    const problem =
      data.email &&
      validatePasswordPolicy(data.password, { email: data.email });

    if (problem) {
      ctx.addIssue({ code: "custom", message: problem, path: ["password"] });
    }
  });
