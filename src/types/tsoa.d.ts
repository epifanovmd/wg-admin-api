import { SecurityScopes } from "../core";

declare module "tsoa" {
  export function Security(name: "jwt", scopes?: SecurityScopes): Function;
}
