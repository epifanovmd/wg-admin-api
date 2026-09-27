/**
 * План установки агента на VPS: последовательность shell-шагов. Все данные
 * передаются в base64 — в команды не попадает ни одного пользовательского
 * символа, экранирование не требуется.
 */
export interface IProvisionStep {
  title: string;
  command: string;
  /** Таймаут шага; по умолчанию — таймаут SSH-раннера. */
  timeoutMs?: number;
}

/** Куда на VPS загружается установщик перед запуском. */
export const INSTALL_SCRIPT_PATH = "/tmp/wg-admin-install.sh";

/**
 * Установка по SSH — тот же установщик, что и для ручной установки: он
 * ставит зависимости, скачивает бинарь агента с бэкенда по ключу и
 * включает службу systemd. Ключ передаётся в base64 — экранирование не нужно.
 */
export const buildProvisionPlan = (input: {
  agentKey: string;
}): IProvisionStep[] => {
  const keyB64 = Buffer.from(input.agentKey, "utf8").toString("base64");

  return [
    {
      title: "Установка агента (зависимости, бинарь, служба systemd)",
      command:
        `sh ${INSTALL_SCRIPT_PATH} --key "$(echo ${keyB64} | base64 -d)"; ` +
        `code=$?; rm -f ${INSTALL_SCRIPT_PATH}; exit $code`,
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
export const buildUninstallPlan = (): IProvisionStep[] => [
  {
    title: "Удаление агента (откат созданного им)",
    command:
      `sh ${INSTALL_SCRIPT_PATH} --uninstall; ` +
      `code=$?; rm -f ${INSTALL_SCRIPT_PATH}; exit $code`,
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
