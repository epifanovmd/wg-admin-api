import { inject } from "inversify";
import type { Request } from "koa";

import type { AuthContext } from "../../types/koa";
import { Injectable } from "../decorators";
import type { ISecurityScheme } from "./security-scheme";
import { SecurityScopes, TokenService } from "./token.service";

/** `@Security("jwt", scopes)`: access-токен пользователя в `Authorization: Bearer`. */
@Injectable()
export class JwtSecurityScheme implements ISecurityScheme {
  readonly name = "jwt";

  constructor(@inject(TokenService) private readonly _tokens: TokenService) {}

  authenticate(request: Request, scopes: string[]): Promise<AuthContext> {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];

    return this._tokens.verify(
      type === "Bearer" ? token : undefined,
      scopes as SecurityScopes,
    );
  }
}
