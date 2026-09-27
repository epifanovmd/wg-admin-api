import { expect } from "chai";
import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";

const SRC = resolve(__dirname, "../..");
const MODULES = join(SRC, "modules");

/** import/export … from "x", import("x"), require("x"). */
const SPECIFIER_RE =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

const listTsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return listTsFiles(path);

    return entry.name.endsWith(".ts") ? [path] : [];
  });

/** Файлы каталога, импортирующие что-либо из `src/modules`. */
const findModuleImports = (dir: string): string[] =>
  listTsFiles(dir).flatMap(file => {
    const source = readFileSync(file, "utf8");

    return [...source.matchAll(SPECIFIER_RE)]
      .map(match => match[1])
      .filter(spec => spec.startsWith("."))
      .filter(spec => {
        const target = resolve(dirname(file), spec);

        return target === MODULES || target.startsWith(MODULES + sep);
      })
      .map(spec => `${relative(SRC, file)} → ${spec}`);
  });

/**
 * Архитектурный страж: ядро и глобальные типы не зависят от доменных
 * модулей — зависимости идут только из модулей в ядро.
 */
describe("Границы ядра", () => {
  it("src/core/** не импортирует src/modules/**", () => {
    expect(findModuleImports(join(SRC, "core"))).to.deep.equal([]);
  });

  it("src/types/** не импортирует src/modules/**", () => {
    expect(findModuleImports(join(SRC, "types"))).to.deep.equal([]);
  });
});
