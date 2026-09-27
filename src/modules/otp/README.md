# Модуль OTP (One-Time Password)

Шестизначные коды для подтверждения email. Контроллера нет — используется модулем user.

## Структура файлов

```
src/modules/otp/
├── otp.module.ts
├── otp.entity.ts
├── otp.repository.ts
├── otp.service.ts
├── otp.errors.ts          # OtpError (OTP_*)
├── otp-cleanup.job.ts     # OtpCleanupJob (cron)
├── *.test.ts
└── index.ts
```

## Сущность `Otp` (таблица `otp`)

| Поле                      | Тип           | Описание                               |
| ------------------------- | ------------- | -------------------------------------- |
| `userId`                  | `uuid` (PK)   | Один код на пользователя               |
| `code`                    | `varchar(6)`  | Код                                    |
| `expireAt`                | `timestamptz` | Срок (`config.auth.otp.expireMinutes`) |
| `attempts`                | `int`         | Неудачные попытки ввода текущего кода  |
| `sentAt`                  | `timestamptz` | Время отправки — для cooldown          |
| `createdAt` / `updatedAt` | `timestamptz` |                                        |

`OneToOne → User` (`CASCADE`).

## `OtpService`

| Метод                 | Описание                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(userId)`      | Новый код (upsert, `attempts = 0`). Повтор раньше `OTP_RESEND_COOLDOWN_MS` (60 с) → 429 `OTP_RESEND_COOLDOWN`. Возвращает `{ code, expireAt }`. |
| `check(userId, code)` | Проверяет и гасит код. Ошибки — 400: `OTP_INVALID_CODE`, `OTP_CODE_EXPIRED`, `OTP_ATTEMPTS_EXHAUSTED`.                                          |

## Правила

- Неверный код атомарно увеличивает `attempts`; на `OTP_MAX_ATTEMPTS` (5) запись удаляется.
- Истёкший или исчерпанный код удаляется, ответ 400 (не 410/500).
- Успех — удаление по условию `{ userId, code }`; при гонке проходит только одна проверка.

## Задачи

`OtpCleanupJob` — очередь `otp.cleanup`, cron `*/30 * * * *`: удаляет коды с
`expireAt <= now()` (`OtpRepository.deleteExpired`).
