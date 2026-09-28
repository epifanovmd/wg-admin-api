import { readFileSync } from "node:fs";
import path from "node:path";

import { TEMPLATES_DIR } from "../../core";

/**
 * Установщик агента (POSIX sh) — `templates/wg-provision/install.sh`: один
 * для ручной установки (`curl …/api/v1/wg-agent/install.sh | sudo sh -s --
 * --key <ключ>`), установки и удаления по SSH из админки.
 */
export const INSTALL_SCRIPT_TEMPLATE = path.join(
  TEMPLATES_DIR,
  "wg-provision",
  "install.sh",
);

const BACKEND_URL_PLACEHOLDER = "__BACKEND_URL__";

let template: string | null = null;

const readTemplate = (): string => {
  template ??= readFileSync(INSTALL_SCRIPT_TEMPLATE, "utf8");

  return template;
};

/** Установщик с адресом бэкенда в одинарных кавычках sh. */
export const renderInstallScript = (backendUrl: string): string => {
  const quoted = `'${backendUrl.replace(/'/g, `'\\''`)}'`;

  // Функция-замена: `$'`, `$&` в адресе не должны трактоваться как шаблон.
  return readTemplate().replace(BACKEND_URL_PLACEHOLDER, () => quoted);
};
