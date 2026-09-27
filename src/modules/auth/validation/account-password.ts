import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
} from "../../../core";

/**
 * Новый пароль аккаунта по политике (`validatePasswordPolicy`): длина и
 * список частых паролей. Совпадение с email проверяется там, где email известен.
 */
export const accountPassword = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Пароль не должен превышать ${PASSWORD_MAX_LENGTH} символов`,
  )
  .superRefine((value, ctx) => {
    const problem = validatePasswordPolicy(value);

    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
