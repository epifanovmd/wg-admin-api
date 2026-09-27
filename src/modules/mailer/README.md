# Модуль Mailer

Инфраструктурный модуль почты: письма ставятся в очередь `mail.send`, обработчик
рендерит локализованный шаблон (HTML + текст) и отправляет по SMTP с повторами.
Контроллера и эндпоинтов нет.

## Структура файлов

```
src/modules/mailer/
├── mailer.module.ts        # MailRenderer, MailerService, asJobHandler(MailSendJob)
├── mailer.service.ts       # send (в очередь), deliver (синхронно, только для обработчика)
├── mail-send.job.ts        # MailSendJob — обработчик очереди mail.send
├── mail-renderer.ts        # MailRenderer — рендер шаблонов из templates/mail
├── mailer.types.ts         # шаблоны и их данные, локали, данные задачи
├── mailer.errors.ts        # MailError — коды MAIL_*
└── index.ts
```

## API

| Метод                                             | Описание                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `send(template, to, data, { locale?, manager? })` | Поставить письмо в очередь. Данные типизированы по шаблону (`IMailTemplateData`).        |
| `sendCodeMail(email, code, options?)`             | Обёртка: шаблон `otp-code`.                                                              |
| `sendResetPasswordMail(email, token, options?)`   | Обёртка: шаблон `reset-password`, ссылка из `config.auth.resetPassword.webUrl`.          |
| `deliver(job)`                                    | Рендер и SMTP-отправка. **Только для обработчика `mail.send`** — синхронно больше нигде. |

- `locale` — любая строка (`profile.locale`, `en-US`); приводится к `ru`/`en`
  (`resolveMailLocale`), неизвестная или пустая — `ru`.
- `manager` — транзакция вызывающего: задача создаётся атомарно с его изменениями
  (outbox). Откат транзакции — письма нет.
- Данные шаблона (коды, ссылки) хранятся в задаче до её выполнения.

## Задача `mail.send`

| Параметр   | Значение                                       |
| ---------- | ---------------------------------------------- |
| Данные     | `{ template, to, data, locale }`               |
| Повторы    | 5, первая задержка 30 с, экспоненциальный рост |
| Срок       | 120 с                                          |
| Обработчик | `MailSendJob` → `MailerService.deliver`        |

Ошибки обработчика — `JobError`:

| Ситуация                                   | Код                       | Повтор |
| ------------------------------------------ | ------------------------- | ------ |
| Временный сбой SMTP (сеть, 4xx)            | `MAIL_UNAVAILABLE`        | да     |
| Постоянный отказ SMTP (`responseCode` 5xx) | `MAIL_UNAVAILABLE`        | нет    |
| Нет шаблона/файла шаблона                  | `MAIL_TEMPLATE_NOT_FOUND` | нет    |
| SMTP не настроен в production              | `MAIL_NOT_CONFIGURED`     | нет    |

## SMTP и поведение без него

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`/`SMTP_PASS` (без логина — без
авторизации), `SMTP_FROM` (по умолчанию `SMTP_USER`). Письмо уходит с HTML и
текстовой версией.

- **SMTP не настроен, production**: `send` сразу бросает `MAIL_NOT_CONFIGURED` (503) —
  задача не ставится; если задача всё же попала в очередь, она падает `JobError` без
  повторов.
- **SMTP не настроен, development/test**: задача ставится, обработчик пишет письмо в
  лог (шаблон, локаль и данные — строкой, чтобы логгер не маскировал код).
- Локально — Mailpit из `docker-compose.dev.yml`: SMTP `localhost:1025`, UI :8025.

## Шаблоны (`templates/mail/`)

```
templates/mail/
├── layout.ejs              # общий HTML-layout: lang, subject, content, footer
├── layout.txt.ejs          # общий текстовый layout: content + подпись
└── <locale>/               # ru, en — полный набор в каждой
    ├── footer.txt.ejs      # подпись (appName)
    ├── <name>.subject.ejs  # тема (одна строка)
    ├── <name>.ejs          # HTML-тело
    └── <name>.txt.ejs      # текстовая версия
```

| Шаблон                | Данные                                 | Назначение                            |
| --------------------- | -------------------------------------- | ------------------------------------- |
| `otp-code`            | `code`                                 | код подтверждения email               |
| `reset-password`      | `resetLink`                            | ссылка сброса пароля                  |
| `email-change-code`   | `code`, `newEmail`, `expiresInMinutes` | код смены email — на новый адрес      |
| `email-change-notice` | `newEmail`                             | уведомление о смене — на старый адрес |

В каждый шаблон дополнительно передаются `appName` (`config.app.name`) и `locale`.
В HTML данные экранируются (`<%= %>`), в теме и текстовой версии — нет. Файлы
компилируются один раз. Новый шаблон: файлы во **всех** локалях + ключ в
`IMailTemplateData` и `MAIL_TEMPLATE_NAMES` — тест полноты это проверит.

## Ошибки (`MailError`, коды `MAIL_*`)

| Код                       | Статус | Когда                |
| ------------------------- | ------ | -------------------- |
| `MAIL_NOT_CONFIGURED`     | 503    | production без SMTP  |
| `MAIL_UNAVAILABLE`        | 503    | сбой SMTP (в задаче) |
| `MAIL_TEMPLATE_NOT_FOUND` | 500    | нет файла шаблона    |

## Зависимости

`JobQueue` (ядро, реализация — модуль jobs), `nodemailer`, `ejs`,
`config.email.smtp`, `config.auth.resetPassword.webUrl`, `config.app.name`.

## Использование

- **User** — код подтверждения email, письма смены email (в транзакции запроса).
- **Auth** — ссылка сброса пароля (`sendResetPasswordMail`).

## Тесты

- `mailer.service.test.ts` — постановка в очередь (локаль, `manager`, 503 в
  production), `deliver` (отправка, лог в dev, классы ошибок `JobError`),
  `MailSendJob`, `resolveMailLocale`.
- `mail-renderer.test.ts` — полнота файлов по локалям; рендер каждого шаблона в
  каждой локали: тема, layout, экранирование в HTML, текст без HTML, без смеси языков.
