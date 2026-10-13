/**
 * План установки агента на VPS: последовательность shell-шагов. Токен
 * регистрации — файлом в рабочем каталоге, в аргументы команд он не
 * попадает; остальные значения команды экранирует ядро агента.
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
 * Снять агента прежнего поколения экземпляра `instance` (данные без `agent.db`):
 * служба останавливается без уборки — его воркеры по SIGTERM ничего не
 * разбирают, интерфейсы, туннели и правила WireGuard остаются работать, а
 * `/etc/wireguard` и `/var/lib/wg-admin` новый воркер wg считает своими.
 * Процессы воркеров (pid из `processes/*.json`) завершаются, только если это
 * действительно они (рабочий каталог или программа — в каталогах агента);
 * программа, настройки, данные и служба удаляются: новый агент ставится по тем
 * же путям. Нового агента и узел без агента шаг не трогает.
 */
export const removePreviousAgent = (instance: string): string => {
  const data = `/var/lib/agent-${instance}`;
  const opt = `/opt/agent-${instance}`;

  return [
    `if [ -f ${data}/agent.status ] && [ ! -f ${data}/agent.db ]; then`,
    `systemctl disable --now agent-${instance}.service 2>/dev/null || true;`,
    "pids=;",
    `for f in ${data}/processes/*.json; do`,
    String.raw`p=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$f" 2>/dev/null);`,
    `case "$(readlink /proc/$p/cwd 2>/dev/null) $(readlink /proc/$p/exe 2>/dev/null)" in`,
    `*${data}/*|*${opt}/*) pids="$pids $p" ;; esac;`,
    "done;",
    'if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null || true;',
    "for i in $(seq 30); do alive=; for p in $pids; do kill -0 $p 2>/dev/null && alive=1; done;",
    '[ -z "$alive" ] && break; sleep 1; done;',
    "kill -KILL $pids 2>/dev/null || true; fi;",
    `rm -f /etc/systemd/system/agent-${instance}.service /usr/local/bin/agent-${instance};`,
    "systemctl daemon-reload;",
    `rm -rf ${opt} /etc/agent-${instance} ${data};`,
    'echo "Прежний агент снят: интерфейсы, туннели и правила WireGuard работают";',
    "fi",
  ].join(" ");
};

/** Команда установки `curl -fsSL '<install.sh>' | [sudo ]sh -s -- <флаги>`. */
const INSTALL_COMMAND = /^curl -fsSL ('[^']+') \| (?:sudo )?sh -s -- (.+)$/;

/**
 * Команда установки для запуска от root (`sudo` добавляет `withSudo` при
 * нужде), установщик — файлом в рабочем каталоге: в `curl … | sh` провал
 * скачивания (404, сеть) терялся бы — `sh` получил бы пустой скрипт и вышел
 * с успехом.
 */
export const installViaFile = (command: string, workDir: string): string => {
  const match = INSTALL_COMMAND.exec(command);

  if (!match) return command.replace("| sudo sh -s --", "| sh -s --");

  const script = `${workDir}/install.sh`;

  return `curl -fsSL ${match[1]} -o ${script} && sh ${script} ${match[2]}`;
};

/**
 * Установка по SSH — та же команда, что для ручной установки (`install.sh`
 * с бэкенда → `agent install`): агент службой systemd, воркеры wg и socks с
 * сервера, пакеты и параметры ядра. Перед ней — снятие агента прежнего
 * поколения (`removePreviousAgent`). Токен — файлом (`--token-file`): в
 * аргументах команды его видел бы любой пользователь хоста всё время
 * установки.
 */
export const buildProvisionPlan = (
  workDir: string,
  installCommand: string,
  instance: string,
): IProvisionStep[] => [
  {
    title: "Подготовка узла (снятие прежнего агента)",
    command: removePreviousAgent(instance),
    timeoutMs: 180_000,
  },
  {
    title: "Установка агента (пакеты, воркеры, служба systemd)",
    command:
      `${installViaFile(installCommand, workDir)}; ` +
      `code=$?; rm -rf ${workDir}; exit $code`,
    timeoutMs: 900_000,
  },
];

/** Программа агента экземпляра на узле (`agent install --instance`). */
export const agentBinaryPath = (instance: string | undefined): string =>
  instance ? `/opt/agent-${instance}/bin/agent` : "/opt/agent/bin/agent";

/**
 * Удаление агента: воркеры убирают созданное ими (`./cleanup`: интерфейсы,
 * туннели, правила), служба, программа, настройки, данные и пакеты,
 * поставленные установкой (`--purge`). Другие экземпляры агента на узле не
 * затрагиваются.
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
