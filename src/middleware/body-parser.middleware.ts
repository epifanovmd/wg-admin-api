import { bodyParser } from "@koa/bodyparser";

/** JSON и формы. */
export const bodyParserMiddleware = bodyParser({
  enableTypes: ["json", "form"],
  jsonLimit: "1mb",
  formLimit: "1mb",
});
