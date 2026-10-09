/** Версия запущенного бэкенда и агента, которого он раздаёт. */
export interface IAppVersionDto {
  /** Версия сборки: тег релиза или SHA (`git describe`), в dev — `package.json`. */
  version: string;
  /** Короткий SHA коммита; null — процесс запущен не из образа. */
  commit: string | null;
  /** Время сборки образа (ISO 8601); null — процесс запущен не из образа. */
  builtAt: string | null;
  /** Время запуска процесса (ISO 8601). */
  startedAt: string;
  /**
   * Версия агента в выпуске, который бэкенд раздаёт узлам (установка и
   * обновление); null — выпуска нет. Установленная на ноде — `agentVersion`
   * ноды.
   */
  agentVersion: string | null;
}
