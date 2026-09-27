import { expect } from "chai";
import { escapeXML } from "ejs";
import { existsSync, readdirSync } from "fs";
import path from "path";

import { MAIL_TEMPLATES_DIR, MailRenderer } from "./mail-renderer";
import { IMailTemplateData, MAIL_LOCALES, TMailTemplate } from "./mailer.types";

/** Шаблоны модуля почты; письма других модулей проверяют их тесты. */
type TOwnTemplate =
  "otp-code" | "reset-password" | "email-change-code" | "email-change-notice";

/** Данные каждого шаблона со значением, которое нужно экранировать в HTML. */
const SAMPLE: { [K in TOwnTemplate]: IMailTemplateData[K] } = {
  "otp-code": { code: "<b>424242</b>" },
  "reset-password": { resetLink: 'https://x.test/reset?t=1&u="<x>"' },
  "email-change-code": {
    code: "<i>777777</i>",
    newEmail: "new<script>@x.test",
    expiresInMinutes: 15,
  },
  "email-change-notice": { newEmail: "new<script>@x.test" },
};

const OWN_TEMPLATES = Object.keys(SAMPLE) as TOwnTemplate[];

/** Значение из SAMPLE, по которому проверяется подстановка. */
const MARKER: Record<TOwnTemplate, { raw: string; escaped: string }> = {
  "otp-code": {
    raw: "<b>424242</b>",
    escaped: "&lt;b&gt;424242&lt;/b&gt;",
  },
  "reset-password": {
    raw: 'https://x.test/reset?t=1&u="<x>"',
    escaped: "https://x.test/reset?t=1&amp;u=&#34;&lt;x&gt;&#34;",
  },
  "email-change-code": {
    raw: "<i>777777</i>",
    escaped: "&lt;i&gt;777777&lt;/i&gt;",
  },
  "email-change-notice": {
    raw: "new<script>@x.test",
    escaped: "new&lt;script&gt;@x.test",
  },
};

/** Имена шаблонов локали — по файлам темы `<name>.subject.ejs`. */
const templatesOf = (locale: string): string[] =>
  readdirSync(path.join(MAIL_TEMPLATES_DIR, locale))
    .filter(file => file.endsWith(".subject.ejs"))
    .map(file => file.replace(".subject.ejs", ""))
    .sort();

const CYRILLIC = /[а-яё]/i;

describe("MailRenderer", () => {
  const renderer = new MailRenderer();

  it("у каждой локали полный набор файлов каждого шаблона", () => {
    const names = templatesOf(MAIL_LOCALES[0]);

    expect(names).to.include.members(OWN_TEMPLATES);

    for (const locale of MAIL_LOCALES) {
      expect(templatesOf(locale), locale).to.deep.equal(names);

      for (const name of names) {
        for (const suffix of [".ejs", ".txt.ejs", ".subject.ejs"]) {
          const file = path.join(
            MAIL_TEMPLATES_DIR,
            locale,
            `${name}${suffix}`,
          );

          expect(existsSync(file), file).to.be.true;
        }
      }

      expect(
        existsSync(path.join(MAIL_TEMPLATES_DIR, locale, "footer.txt.ejs")),
      ).to.be.true;
    }
  });

  for (const locale of MAIL_LOCALES) {
    for (const name of OWN_TEMPLATES) {
      describe(`${locale}/${name}`, () => {
        const mail = renderer.render(name, locale, SAMPLE[name] as never);
        const marker = MARKER[name];

        it("тема — непустая одна строка", () => {
          expect(mail.subject).to.be.a("string").and.not.be.empty;
          expect(mail.subject).to.not.match(/[\r\n]/);
        });

        it("HTML: общий layout, язык, тема и экранированные данные", () => {
          expect(mail.html).to.include(`<html lang="${locale}">`);
          expect(mail.html).to.include(
            `<title>${escapeXML(mail.subject)}</title>`,
          );
          expect(mail.html).to.include(marker.escaped);
          expect(mail.html).to.not.include(marker.raw);
          expect(mail.html).to.not.include("<script>");
        });

        it("текстовая версия: данные как есть, без HTML", () => {
          expect(mail.text).to.include(marker.raw);
          expect(mail.text).to.not.match(/<(p|div|a|strong)[\s>]/);
          expect(mail.text).to.include("--");
        });

        it("без смеси языков", () => {
          const visible = `${mail.subject}\n${mail.text}`;

          if (locale === "en") {
            expect(visible).to.not.match(CYRILLIC);
          } else {
            expect(mail.subject).to.match(CYRILLIC);
          }
        });
      });
    }
  }

  it("тема не экранируется как HTML", () => {
    const mail = renderer.render("otp-code", "ru", { code: "&" });

    expect(mail.subject).to.not.include("&amp;");
  });

  it("неизвестный шаблон — MAIL_TEMPLATE_NOT_FOUND", () => {
    try {
      renderer.render("missing" as TMailTemplate, "ru", {} as never);
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.code).to.equal("MAIL_TEMPLATE_NOT_FOUND");
    }
  });
});
