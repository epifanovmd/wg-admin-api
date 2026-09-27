/** Минимальная длина пароля аккаунта. */
export const PASSWORD_MIN_LENGTH = 8;

/** Максимальная длина пароля аккаунта. */
export const PASSWORD_MAX_LENGTH = 100;

/**
 * Самые частые пароли из публичных утечек (сравнение без учёта регистра).
 * Короче 8 символов не включены — их отсекает длина.
 */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "123123123",
  "11111111",
  "00000000",
  "88888888",
  "87654321",
  "11223344",
  "12341234",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "1qaz2wsx",
  "zaq12wsx",
  "qwertyui",
  "qwertyuiop",
  "qwerty123",
  "qwerty12",
  "asdfghjkl",
  "asdfasdf",
  "zxcvbnm1",
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "starwars",
  "whatever",
  "trustno1",
  "letmein1",
  "welcome1",
  "welcome123",
  "admin123",
  "administrator",
  "changeme",
  "abc12345",
  "abcd1234",
  "a1b2c3d4",
  "aa123456",
  "computer",
  "internet",
  "michelle",
  "jennifer",
  "master123",
  "dragon123",
  "monkey123",
  "shadow123",
  "qazwsxedc",
  "q1w2e3r4",
  "q1w2e3r4t5",
  "йцукенгш",
  "пароль123",
]);

export interface IPasswordPolicyInput {
  /** Email владельца: пароль не может с ним совпадать. */
  email?: string | null;
  /** Username владельца: пароль не может с ним совпадать. */
  username?: string | null;
}

/**
 * Политика пароля аккаунта: длина, несовпадение с email (и его частью до
 * `@`) и username, отсутствие в списке частых паролей. `null` — пароль подходит,
 * иначе — сообщение для клиента. Применяется при регистрации, сбросе и смене.
 */
export const validatePasswordPolicy = (
  password: string,
  context: IPasswordPolicyInput = {},
): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Пароль не должен превышать ${PASSWORD_MAX_LENGTH} символов`;
  }

  const normalized = password.trim().toLowerCase();
  const email = context.email?.trim().toLowerCase();

  if (email && (normalized === email || normalized === email.split("@")[0])) {
    return "Пароль не должен совпадать с email";
  }

  if (context.username && normalized === context.username.toLowerCase()) {
    return "Пароль не должен совпадать с именем пользователя";
  }

  if (COMMON_PASSWORDS.has(normalized)) {
    return "Пароль слишком простой";
  }

  return null;
};
