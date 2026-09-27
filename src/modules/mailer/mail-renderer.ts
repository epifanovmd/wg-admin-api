import { compile, TemplateFunction } from "ejs";
import { existsSync, readFileSync } from "fs";
import path from "path";

import { config } from "../../config";
import { Injectable, TEMPLATES_DIR } from "../../core";
import { MailError } from "./mailer.errors";
import {
  IMailTemplateData,
  IRenderedMail,
  TMailLocale,
  TMailTemplate,
} from "./mailer.types";

export const MAIL_TEMPLATES_DIR = path.join(TEMPLATES_DIR, "mail");

/** Текстовые части (тема, text/plain) не экранируются как HTML. */
const asText = (value: unknown): string => String(value ?? "");

/**
 * Рендер писем из `templates/mail/`:
 * - `<locale>/<name>.subject.ejs` — тема (одна строка);
 * - `<locale>/<name>.ejs` — HTML-тело, вставляется в общий `layout.ejs`;
 * - `<locale>/<name>.txt.ejs` — текстовая версия, в общий `layout.txt.ejs`;
 * - `<locale>/footer.txt.ejs` — подпись.
 *
 * В HTML данные экранируются (`<%= %>`), в теме и тексте — нет.
 * Каждый файл компилируется один раз.
 */
@Injectable()
export class MailRenderer {
  private readonly _compiled = new Map<string, TemplateFunction>();

  render<T extends TMailTemplate>(
    template: T,
    locale: TMailLocale,
    data: IMailTemplateData[T],
  ): IRenderedMail {
    const vars: Record<string, unknown> = {
      ...data,
      appName: config.app.name,
      locale,
    };
    const subject = this._text(`${locale}/${template}.subject.ejs`, vars)
      .replace(/\s+/g, " ")
      .trim();
    const footer = this._text(`${locale}/footer.txt.ejs`, vars).trim();

    const html = this._html("layout.ejs", {
      lang: locale,
      subject,
      footer,
      content: this._html(`${locale}/${template}.ejs`, vars).trim(),
    });
    const text = this._text("layout.txt.ejs", {
      footer,
      content: this._text(`${locale}/${template}.txt.ejs`, vars).trim(),
    });

    return { subject, html, text: `${text.trim()}\n` };
  }

  private _html(file: string, vars: Record<string, unknown>): string {
    return this._compile(file, "html")(vars);
  }

  private _text(file: string, vars: Record<string, unknown>): string {
    return this._compile(file, "text")(vars);
  }

  private _compile(file: string, mode: "html" | "text"): TemplateFunction {
    const key = `${mode}:${file}`;
    let compiled = this._compiled.get(key);

    if (!compiled) {
      const filename = path.join(MAIL_TEMPLATES_DIR, file);

      if (!existsSync(filename)) {
        throw MailError.TEMPLATE_NOT_FOUND({ file });
      }

      compiled = compile(readFileSync(filename, "utf-8"), {
        filename,
        ...(mode === "text" ? { escape: asText } : {}),
      });
      this._compiled.set(key, compiled);
    }

    return compiled;
  }
}
