import { expect } from "chai";

import spec from "./swagger.json";

type Schema = Record<string, any>;

const schemas = spec.components.schemas as Record<string, Schema>;

/**
 * `allOf: [{type: "string"}, {type: "object"}]` — так tsoa кодирует
 * TypeScript-приём `string & {}`. Такое значение не проходит ни одну
 * валидацию: любой запрос с ним получает 422.
 */
const isUnsatisfiable = (schema: Schema): boolean =>
  Array.isArray(schema.allOf) &&
  schema.allOf.some((s: Schema) => s.type === "string") &&
  schema.allOf.some((s: Schema) => s.type === "object");

const findUnsatisfiable = (
  schema: Schema | undefined,
  path: string,
  seen: Set<string>,
): string[] => {
  if (!schema || typeof schema !== "object") return [];

  if (schema.$ref) {
    const name = schema.$ref.split("/").pop() as string;

    if (seen.has(name)) return [];
    seen.add(name);

    return findUnsatisfiable(schemas[name], `${path} → ${name}`, seen);
  }

  const own = isUnsatisfiable(schema) ? [path] : [];
  const nested = [
    ...Object.entries(schema.properties ?? {}).map(([k, v]) =>
      findUnsatisfiable(v as Schema, `${path}.${k}`, seen),
    ),
    ...["items", "additionalProperties"].map(k =>
      findUnsatisfiable(schema[k], `${path}[${k}]`, seen),
    ),
    ...["anyOf", "oneOf", "allOf"].flatMap(k =>
      (schema[k] ?? []).map((s: Schema) => findUnsatisfiable(s, path, seen)),
    ),
  ].flat();

  return [...own, ...nested];
};

describe("OpenAPI-спецификация", () => {
  it("operationId уникален во всей спецификации (из него — имена функций клиента)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    Object.entries(spec.paths).forEach(([route, ops]) =>
      Object.entries(ops as Record<string, Schema>).forEach(([method, op]) => {
        const key = op.operationId as string;
        const where = `${method.toUpperCase()} ${route}`;
        const first = seen.get(key);

        if (first) duplicates.push(`${key}: ${first}, ${where}`);
        else seen.set(key, where);
      }),
    );

    expect(duplicates).to.deep.equal([]);
  });

  it("тела запросов не содержат невыполнимых схем (`string & {}`)", () => {
    const problems = Object.entries(spec.paths).flatMap(([route, ops]) =>
      Object.entries(ops as Record<string, Schema>).flatMap(([method, op]) =>
        findUnsatisfiable(
          op.requestBody?.content?.["application/json"]?.schema,
          `${method.toUpperCase()} ${route}`,
          new Set(),
        ),
      ),
    );

    expect(problems).to.deep.equal([]);
  });
});
