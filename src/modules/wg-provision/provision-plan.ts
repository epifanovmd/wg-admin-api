/**
 * План установки агента на VPS: последовательность shell-шагов. Данные
 * (установщик, ключ агента) — файлами в рабочем каталоге: в команды не
 * попадает ни одного пользовательского символа, экранирование не требуется.
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
 * хоста заранее создать файл и подменить установщик до запуска от root.
 */
export const WORK_DIR_COMMAND = "mktemp -d /tmp/wg-admin.XXXXXXXX";

/** Путь из вывода `mktemp` — только такой попадает в команды. */
export const WORK_DIR_PATTERN = /^\/tmp\/wg-admin\.[A-Za-z0-9]+$/;

/** Файлы в рабочем каталоге: установщик и ключ агента. */
export const workFiles = (workDir: string) => ({
  script: `${workDir}/install.sh`,
  key: `${workDir}/agent.key`,
});

/**
 * Установка по SSH — тот же установщик, что и для ручной установки: он
 * ставит зависимости, скачивает бинарь агента с бэкенда по ключу и
 * включает службу systemd. Ключ — файлом (`--key-file`): в аргументах
 * команды его видел бы любой пользователь хоста всё время установки.
 */
export const buildProvisionPlan = (workDir: string): IProvisionStep[] => {
  const files = workFiles(workDir);

  return [
    {
      title: "Установка агента (зависимости, бинарь, служба systemd)",
      command:
        `sh ${files.script} --key-file ${files.key}; ` +
        `code=$?; rm -rf ${workDir}; exit $code`,
      timeoutMs: 900_000,
    },
  ];
};

/**
 * Удаление агента: остановка службы (агент по SIGTERM откатывает свои
 * интерфейсы, туннели и пробросы), страховочный \`cleanup\`, откат хоста по
 * журналу установки (пакеты, forwarding, модули), удаление бинаря, unit и
 * /etc/wg-admin.
 */
export const buildUninstallPlan = (workDir: string): IProvisionStep[] => [
  {
    title: "Удаление агента (откат созданного им)",
    command:
      `sh ${workFiles(workDir).script} --uninstall; ` +
      `code=$?; rm -rf ${workDir}; exit $code`,
    timeoutMs: 180_000,
  },
];

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
