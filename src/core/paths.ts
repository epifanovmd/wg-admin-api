import path from "path";

/**
 * Единственное место, где код узнаёт, где лежит проект. Файл живёт в
 * `src/core/` и компилируется в `build/core/` — в обоих случаях корень
 * проекта на два уровня выше. Рабочая директория процесса значения не имеет.
 */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/** Ассеты, которые читаются в рантайме и не проходят через компилятор. */
export const TEMPLATES_DIR = path.join(PROJECT_ROOT, "templates");

/** Путь из конфига: абсолютный — как есть, относительный — от корня проекта. */
export const resolveFromRoot = (target: string): string =>
  path.isAbsolute(target) ? target : path.resolve(PROJECT_ROOT, target);
