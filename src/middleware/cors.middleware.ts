import cors from "@koa/cors";

import { config } from "../config";
import { REQUEST_ID_HEADER } from "./request-id.middleware";

/** Общая для HTTP и Socket.IO политика: `*` — любой origin, иначе точное совпадение. */
export const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return false;

  const { allowedOrigins } = config.cors;

  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
};

export const corsMiddleware = cors({
  origin: ctx => {
    const { origin } = ctx.request.header;

    return origin && isAllowedOrigin(origin) ? origin : "";
  },
  exposeHeaders: [
    "WWW-Authenticate",
    "Server-Authorization",
    REQUEST_ID_HEADER,
  ],
  maxAge: 86400,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    REQUEST_ID_HEADER,
    "X-Device-Name",
    "X-Device-Type",
  ],
});
