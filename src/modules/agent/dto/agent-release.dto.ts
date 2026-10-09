/**
 * Откуда сборка: `remote` — удалённый источник сборок агента (GitHub или
 * `AGENT_RELEASES_URL`), `local` — каталог воркеров проекта
 * (`AGENT_RELEASES_DIR`).
 */
export type TAgentReleaseSource = "remote" | "local";

/** Сборка агента. */
export interface IAgentReleaseArtifactDto {
  os: string;
  arch: string;
  /** Имя файла для `…/agent-link/releases/<file>`. */
  file: string;
  sha256: string;
  signature?: string;
  source: TAgentReleaseSource;
  /** Ссылка на сборку в источнике или путь от корня бэкенда. */
  url: string;
}

/** Сборка воркера. */
export interface IAgentWorkerArtifactDto extends IAgentReleaseArtifactDto {
  name: string;
  version: string;
  /** Что запускать в сборке-архиве. */
  command?: string;
  stopTimeout?: string;
}

/** Версия агента в удалённом источнике: какая, откуда, когда проверена. */
export interface IAgentRemoteReleaseDto {
  version: string;
  /** `github:owner/repo` или адрес сборок (url). */
  from: string;
  /** Когда источник проверен, мс с 1970-01-01. */
  checkedAt: number;
  /** Ключ подписи сборок агента (base64). */
  publicKey?: string;
}

/**
 * Итоговый манифест сборок: агент и netprobe — из удалённого источника, воркеры
 * проекта (wg, socks) — из `AGENT_RELEASES_DIR`.
 */
export interface IAgentReleaseManifestDto {
  version: string;
  publicKey?: string;
  artifacts: IAgentReleaseArtifactDto[];
  workers?: IAgentWorkerArtifactDto[];
  /** Нет — сборки агента ещё не получены (или источник не задан). */
  remote?: IAgentRemoteReleaseDto;
}

/** В источнике появилась новая версия агента (сокет `agent:release`). */
export interface IAgentReleaseNoticeDto {
  version: string;
  /** Прежняя версия; нет — версия получена впервые после запуска бэкенда. */
  previous?: string;
  /** `github:owner/repo` или адрес сборок (url). */
  from: string;
}

/** Агент, которого можно обновить до новой версии. */
export interface IAgentUpdateCandidateDto {
  agentId: string;
  name: string;
  online: boolean;
  current: string;
  target: string;
  os: string;
  arch: string;
}

/** Воркер со сборкой с сервера, которого можно обновить. */
export interface IAgentWorkerUpdateCandidateDto {
  agentId: string;
  agentName: string;
  online: boolean;
  worker: string;
  current: string;
  target: string;
  os: string;
  arch: string;
}

/** Сборки агента и кого можно обновить. */
export interface IAgentReleaseDto {
  /** `null` — каталог сборок не задан или пуст. */
  manifest: IAgentReleaseManifestDto | null;
  candidates: IAgentUpdateCandidateDto[];
  workerCandidates: IAgentWorkerUpdateCandidateDto[];
}

/** Параметры команды установки агента на узел (флаги `install.sh`). */
/** Пакеты по менеджерам (`--packages-apt` и т. п.). */
export interface IAgentPackagesByManagerDto {
  apt?: string[];
  dnf?: string[];
  yum?: string[];
  apk?: string[];
  zypper?: string[];
}

export interface ICreateAgentInstallCommandBody {
  /** Токен регистрации; ровно одно из `token` и `tokenFile`. */
  token?: string;
  /** Путь к файлу с токеном на узле. */
  tokenFile?: string;
  /** Адрес сервера; без него — `AGENT_PUBLIC_URL` или `APP_PUBLIC_URL`. */
  baseUrl?: string;
  name?: string;
  /** Пользователь службы агента. */
  user?: string;
  /** Путь к `agent.yaml` на узле. */
  config?: string;
  privileged?: boolean;
  /** `process` | `mixed`. */
  killMode?: "process" | "mixed";
  packages?: string[];
  /** Свои имена пакетов для менеджера: на узле с ним заменяют `packages`. */
  packagesByManager?: IAgentPackagesByManagerDto;
  sysctl?: Record<string, string>;
  rwPaths?: string[];
  caFile?: string;
  /** Воркеры с сервера. */
  workers?: string[];
  /** Например `30s`. */
  stopTimeout?: string;
  /** Другой источник сборок воркеров (`--releases`). */
  releases?: string;
}

export interface IAgentInstallCommandDto {
  /** `curl … | sudo sh -s -- …`. */
  command: string;
}
