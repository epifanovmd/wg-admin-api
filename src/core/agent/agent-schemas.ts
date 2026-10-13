import Ajv, { ValidateFunction } from "ajv";

const MAX_COMPILED = 500;
const MAX_PROBLEMS = 10;

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
const compiled = new Map<string, ValidateFunction | null>();

const compile = (schema: object): ValidateFunction | null => {
  const key = JSON.stringify(schema);
  let fn = compiled.get(key);

  if (fn !== undefined) return fn;
  try {
    fn = ajv.compile(schema);
  } catch {
    // Схема воркера, которую нельзя собрать, не мешает работе: проверки нет.
    fn = null;
  }
  if (compiled.size >= MAX_COMPILED) compiled.clear();
  compiled.set(key, fn);

  return fn;
};

/**
 * Замечания проверки `value` по JSON Schema из манифеста воркера (`[]` — подходит). Нет схемы
 * или она не собирается — без замечаний: схемы проверяет бэкенд, агент их только передаёт.
 */
export const schemaProblems = (schema: unknown, value: unknown): string[] => {
  if (!schema || typeof schema !== "object") return [];
  const fn = compile(schema);

  if (!fn || fn(value)) return [];

  return (fn.errors ?? [])
    .slice(0, MAX_PROBLEMS)
    .map(e => `${e.instancePath || "/"} ${e.message ?? "не подходит"}`.trim());
};
