import { expect } from "chai";

import { BASE_URL, E2E } from "./harness";

export interface Res<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

export interface Actor {
  id: string;
  email: string;
  password: string;
  access: string;
  refresh: string;
  sessionId: string;
  /** IP клиента за доверенным прокси: у каждого свой, как в жизни. */
  ip: string;
}

/** Вызванные эндпоинты «METHOD /path» — для проверки покрытия спецификации. */
export const calledEndpoints: Array<{ method: string; path: string }> = [];

let ipSeq = 0;
const nextIp = () => {
  ipSeq += 1;

  return `10.${Math.floor(ipSeq / 65536) % 256}.${Math.floor(ipSeq / 256) % 256}.${ipSeq % 256}`;
};

let emailSeq = 0;

export const uniqueEmail = (prefix: string) => {
  emailSeq += 1;

  return `${prefix}-${Date.now().toString(36)}-${emailSeq}@e2e.local`;
};

export interface CallOptions {
  headers?: Record<string, string>;
  /** Схема заголовка авторизации: Bearer (по умолчанию), Bot, ApiKey. */
  scheme?: string;
  ip?: string;
}

/** Запрос к API от имени токена (строка) или участника (Actor). */
export const call = async <T = any>(
  who: Actor | string | null,
  method: string,
  path: string,
  body?: unknown,
  options: CallOptions = {},
): Promise<Res<T>> => {
  const headers: Record<string, string> = { ...options.headers };
  const token = typeof who === "string" ? who : who?.access;

  headers["x-forwarded-for"] =
    options.ip ?? (typeof who === "object" && who ? who.ip : nextIp());
  if (token) headers.authorization = `${options.scheme ?? "Bearer"} ${token}`;

  let payload: FormData | string | undefined;

  if (body instanceof FormData) payload = body;
  else if (body !== undefined && body !== null) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  calledEndpoints.push({ method, path: path.split("?")[0] });

  const res = await fetch(BASE_URL + path, { method, headers, body: payload });
  const text = await res.text();
  let data: any;

  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  return { status: res.status, data, headers: res.headers };
};

/** Статус ответа (и доменный код ошибки) с понятным сообщением при провале. */
export const expectStatus = <T>(
  res: Res<T>,
  status: number | number[],
  code?: string,
): Res<T> => {
  const expected = ([] as number[]).concat(status);

  expect(
    expected,
    `ожидался ${expected.join("/")}, получен ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 400)}`,
  ).to.include(res.status);
  if (code) expect((res.data as any)?.code, "код ошибки").to.equal(code);

  return res;
};

const tokensOf = (data: any) => data?.tokens ?? data;

export const toActor = (
  res: Res,
  extra: { email: string; password: string; ip: string },
): Actor => {
  const tokens = tokensOf(res.data);

  return {
    id: res.data?.id,
    access: tokens?.accessToken,
    refresh: tokens?.refreshToken,
    sessionId: tokens?.sessionId,
    ...extra,
  };
};

/** Новый пользователь: регистрация по email. */
export const signUp = async (
  prefix: string,
  profile: Record<string, unknown> = {},
): Promise<Actor> => {
  const email = uniqueEmail(prefix);
  const password = `${prefix}-Pass-${Math.random().toString(36).slice(2, 8)}`;
  const ip = nextIp();
  const res = expectStatus(
    await call(
      null,
      "POST",
      "/api/v1/auth/sign-up",
      { email, password, ...profile },
      { ip },
    ),
    201,
  );

  return toActor(res, { email, password, ip });
};

export const signIn = async (
  login: string,
  password: string,
  ip = nextIp(),
): Promise<Actor> => {
  const res = expectStatus(
    await call(
      null,
      "POST",
      "/api/v1/auth/sign-in",
      { login, password },
      { ip },
    ),
    200,
  );

  return toActor(res, { email: login, password, ip });
};

export const signInAdmin = () => signIn(E2E.admin.email, E2E.admin.password);

/** Элементы страницы (`IPaginatedDto`/`ICursorPageDto`). */
export const items = <T = any>(data: any): T[] => data?.items ?? [];

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Ждать, пока `probe` вернёт истинное значение (асинхронные задачи). */
export const eventually = async <T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 15_000, intervalMs = 200, what = "условие" } = {},
): Promise<T> => {
  const until = Date.now() + timeoutMs;

  while (Date.now() < until) {
    const value = await probe();

    if (value) return value;
    await wait(intervalMs);
  }

  throw new Error(`Не дождались: ${what}`);
};

// ─── Почта (Mailpit) ─────────────────────────────────────────────────────────

export interface Mail {
  Subject: string;
  HTML: string;
  Text: string;
}

const mailsTo = async (to: string): Promise<Mail[]> => {
  const search = (await fetch(
    `${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  ).then(r => r.json())) as { messages?: Array<{ ID: string }> };

  return Promise.all(
    (search.messages ?? []).map(
      ({ ID }) =>
        fetch(`${E2E.mailpitUrl}/api/v1/message/${ID}`).then(r =>
          r.json(),
        ) as Promise<Mail>,
    ),
  );
};

export const mail = {
  /**
   * Самое новое письмо адресату, подходящее под условие (ждёт — письма
   * уходят через очередь).
   */
  last: (
    to: string,
    match: (m: Mail) => boolean = () => true,
    timeoutMs = 15_000,
  ): Promise<Mail> =>
    eventually(async () => (await mailsTo(to)).find(match), {
      timeoutMs,
      what: `письмо для ${to}`,
    }),
  /** Писем адресату нет (проверка через паузу). */
  none: async (to: string, afterMs = 1500): Promise<boolean> => {
    await wait(afterMs);
    const search = (await fetch(
      `${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then(r => r.json())) as { messages?: unknown[] };

    return !search.messages?.length;
  },
};

/** Шестизначный код из письма. */
export const codeFrom = (m: Mail): string => {
  const code = m.Text.match(/\b(\d{6})\b/)?.[1];

  expect(code, "код в письме").to.be.a("string");

  return code!;
};

/** Токен из ссылки в письме (`?token=...`). */
export const tokenFrom = (m: Mail): string => {
  const token = decodeURIComponent(
    m.Text.match(/token=([^\s&"]+)/)?.[1] ??
      m.HTML.match(/token=([^"&]+)/)?.[1] ??
      "",
  );

  expect(token, "токен в письме").to.not.equal("");

  return token;
};
