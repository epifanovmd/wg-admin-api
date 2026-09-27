import { expect } from "chai";

import spec from "../../src/routing/swagger.json";
import { calledEndpoints } from "./client";

/** Последний файл: каждый эндпоинт спецификации вызван хотя бы одним сценарием. */
describe("покрытие API", () => {
  it("все эндпоинты спецификации вызваны", () => {
    const endpoints = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.keys(ops as object).map(method => ({
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
      })),
    );
    const missed = endpoints
      .filter(
        e =>
          !calledEndpoints.some(
            c => c.method === e.method && e.pattern.test(c.path),
          ),
      )
      .map(e => e.key);

    expect(missed, "не вызваны").to.deep.equal([]);
  });
});
