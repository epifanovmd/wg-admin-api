/**
 * План установки агента на VPS: последовательность shell-шагов. Токен
 * регистрации — файлом в рабочем каталоге, в аргументы команд он не
 * попадает; остальные значения команды экранирует SDK.
 */
export interface IProvisionStep {
  title: string;
  command: string;
  /** Таймаут шага; по умолчанию — таймаут SSH-раннера. */
  timeoutMs?: number;
}

/**
 * Рабочий каталог на VPS: свой на каждый запуск (`mktemp -d`, 0700, владелец —
 * пользователь SSH). Предсказуемый путь в /tmp дал бы другому пользователю
 * хоста заранее создать файл и подменить токен до запуска от root.
 */
export const WORK_DIR_COMMAND = "mktemp -d /tmp/wg-admin.XXXXXXXX";

/** Путь из вывода `mktemp` — только такой попадает в команды. */
export const WORK_DIR_PATTERN = /^\/tmp\/wg-admin\.[A-Za-z0-9]+$/;

/** Файлы в рабочем каталоге: токен регистрации агента. */
export const workFiles = (workDir: string) => ({
  token: `${workDir}/agent.token`,
});

/**
 * Служба `wg-admin-agent` — агент нод без воркеров, который сам держал
 * интерфейсы. Два агента на одних интерфейсах мешали бы друг другу: перед
 * установкой служба останавливается (по SIGTERM она снимает свои
 * интерфейсы, туннели и правила — воркер wg поднимет их заново) и
 * удаляется вместе со своими файлами. Пакеты и параметры ядра остаются.
 */
export const REMOVE_WG_ADMIN_AGENT = [
  "if [ -f /etc/systemd/system/wg-admin-agent.service ]; then",
  "systemctl disable --now wg-admin-agent.service || true;",
  "rm -f /etc/systemd/system/wg-admin-agent.service;",
  "systemctl daemon-reload;",
  "rm -f /usr/local/bin/wg-admin-agent /usr/local/bin/wg-admin-agent.prev /etc/sysctl.d/99-wg-admin.conf;",
  "rm -rf /etc/wg-admin;",
  'echo "Служба wg-admin-agent снята";',
  "fi",
].join(" ");

/** Команда SDK для запуска от root: `sudo` добавляет `withSudo` при нужде. */
export const withoutSudo = (command: string): string =>
  command.replace("| sudo sh -s --", "| sh -s --");

/**
 * Установка по SSH — та же команда, что для ручной установки (`install.sh`
 * с бэкенда → `agent install`): агент службой systemd, воркеры wg и socks из
 * выпуска, пакеты и параметры ядра. Токен — файлом (`--token-file`): в
 * аргументах команды его видел бы любой пользователь хоста всё время
 * установки.
 */
export const buildProvisionPlan = (
  workDir: string,
  installCommand: string,
): IProvisionStep[] => [
  {
    title: "Подготовка узла",
    command: REMOVE_WG_ADMIN_AGENT,
    timeoutMs: 180_000,
  },
  {
    title: "Установка агента (пакеты, воркеры, служба systemd)",
    command:
      `${withoutSudo(installCommand)}; ` +
      `code=$?; rm -rf ${workDir}; exit $code`,
    timeoutMs: 900_000,
  },
];

/** Программа агента экземпляра на узле (`agent install --instance`). */
export const agentBinaryPath = (instance: string | undefined): string =>
  instance ? `/opt/agent-${instance}/bin/agent` : "/opt/agent/bin/agent";

/**
 * Удаление агента: воркеры убирают созданное ими (`POST /cleanup`:
 * интерфейсы, туннели, правила), служба, программа, настройки, данные и
 * пакеты, поставленные установкой (`--purge`). Другие экземпляры агента на
 * узле не затрагиваются.
 */
export const buildUninstallPlan = (
  instance: string | undefined,
): IProvisionStep[] => {
  const binary = agentBinaryPath(instance);
  const flags = instance ? ` --instance ${instance}` : "";

  return [
    {
      title: "Удаление агента (уборка воркеров, служба, данные)",
      command:
        `if [ -x ${binary} ]; then ${binary} uninstall${flags} --purge; ` +
        `else echo "Агент не установлен"; fi`,
      timeoutMs: 300_000,
    },
  ];
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Агент пойдёт к бэкенду по http не на localhost — секреты в открытом виде. */
export const isInsecureBackendUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

/** Команда с повышением прав для не-root пользователя. */
export const withSudo = (command: string, username: string): string =>
  username === "root" ? command : `sudo -n sh -c ${JSON.stringify(command)}`;
