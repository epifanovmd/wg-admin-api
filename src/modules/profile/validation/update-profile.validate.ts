import { z } from "zod";

const MIN_BIRTH_DATE = new Date("1900-01-01T00:00:00Z");

/** Строка остаётся строкой: tsoa валидирует `Date` уже после Zod, по ISO 8601. */
const birthDate = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })], {
    error: "Дата рождения должна быть в формате YYYY-MM-DD",
  })
  .refine(value => new Date(value) >= MIN_BIRTH_DATE, {
    message: "Дата рождения не может быть раньше 1900 года",
  })
  .refine(value => new Date(value).getTime() <= Date.now(), {
    message: "Дата рождения не может быть в будущем",
  });

const name = (label: string) =>
  z
    .string()
    .trim()
    .max(40, `${label} не должно превышать 40 символов`)
    .nullable()
    .optional();

export const UpdateProfileSchema = z.object({
  firstName: name("Имя"),
  lastName: name("Фамилия"),
  birthDate: birthDate.nullable().optional(),
  gender: z
    .string()
    .trim()
    .max(20, "Пол не должен превышать 20 символов")
    .nullable()
    .optional(),
  locale: z
    .string()
    .trim()
    .max(10, "Язык не должен превышать 10 символов")
    .regex(
      /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,4})?$/,
      "Язык указывается кодом: ru, en, en-US",
    )
    .nullable()
    .optional(),
});
