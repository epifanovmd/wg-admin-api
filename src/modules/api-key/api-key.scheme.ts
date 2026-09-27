import { inject } from "inversify";
import type { Request } from "koa";

import { Injectable, ISecurityScheme } from "../../core";
import type { AuthContext } from "../../types/koa";
import { ApiKeyError } from "./api-key.errors";
import { scopeSatisfied } from "./api-key.scopes";
import { ApiKeyService } from "./api-key.service";
import { API_KEY_AUTH_SCHEME, API_KEY_HEADER } from "./api-key.types";

const readKey = (request: Request): string | undefined => {
  const header = request.headers[API_KEY_HEADER];

  if (typeof header === "string" && header) return header.trim();

  const auth = request.headers.authorization;

  return auth?.startsWith(API_KEY_AUTH_SCHEME)
    ? auth.slice(API_KEY_AUTH_SCHEME.length).trim()
    : undefined;
};

/**
 * `@Security("apiKey", scopes)`: ключ из `X-Api-Key` или
 * `Authorization: ApiKey <key>`. Вызывающий — сервис (`kind: "service"`)
 * от имени владельца ключа; scopes ключа — в `permissions` контекста.
 */
@Injectable()
export class ApiKeySecurityScheme implements ISecurityScheme {
  readonly name = "apiKey";

  constructor(@inject(ApiKeyService) private readonly _keys: ApiKeyService) {}

  async authenticate(request: Request, scopes: string[]): Promise<AuthContext> {
    const raw = readKey(request);

    if (!raw) throw ApiKeyError.REQUIRED();

    const apiKey = await this._keys.verify(raw);

    if (!scopes.every(scope => scopeSatisfied(apiKey.scopes, scope))) {
      throw ApiKeyError.SCOPE_DENIED({ required: scopes });
    }

    return {
      kind: "service",
      userId: apiKey.ownerId,
      sessionId: `apikey:${apiKey.id}`,
      roles: [],
      permissions: apiKey.scopes,
      emailVerified: true,
    };
  }
}
