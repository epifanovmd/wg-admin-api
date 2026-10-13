/** Откуда сборка: `local` — сборки проекта (`release/` архивов `AGENT_BUNDLE_DIR`). */
export type TAgentReleaseSource = "local";

/** Сборка агента. */
export interface IAgentReleaseArtifactDto {
  os: string;
  arch: string;
  /** Имя файла для `…/agent-link/releases/<file>`. */
  file: string;
  sha256: string;
  signature?: string;
  source: TAgentReleaseSource;
  /** Ссылка на сборку: путь от корня бэкенда `/api/v1/agent-link/releases/<file>` или сам `file`, если он — адрес. */
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

/**
 * Сборки проекта — `manifest.json` из ``release/` архивов `AGENT_BUNDLE_DIR``
 * (`agent pack --release-out`): версия агента, которым собраны архивы, и
 * сборки воркеров wg и socks. Сборки агента бэкенд не раздаёт: агент берёт их
 * из своего каталога сборок (`update.releases` в `agent.yaml`).
 */
export interface IAgentReleaseManifestDto {
  version: string;
  publicKey?: string;
  artifacts: IAgentReleaseArtifactDto[];
  workers?: IAgentWorkerArtifactDto[];
}

/**
 * Агенты нашли новую версию агента (сокет `agent:release`): новейшая
 * `update.latest` среди агентов выросла.
 */
export interface IAgentReleaseNoticeDto {
  version: string;
  /** Прежняя новейшая версия; нет — первая найденная после запуска бэкенда. */
  previous?: string;
  /** Кто нашёл: `agent:<имя агента>`. */
  from: string;
}

/** Откуда новая версия агента: `agent` — агент нашёл её в своём каталоге сборок сам. */
export type TAgentUpdateSource = "agent";

/** Агент, которого можно обновить до новой версии. */
export interface IAgentUpdateCandidateDto {
  agentId: string;
  name: string;
  online: boolean;
  current: string;
  target: string;
  os: string;
  arch: string;
  source: TAgentUpdateSource;
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

/** Команда установки агента на ноду: архив папки агента с этого сервера и токен. */
export interface ICreateAgentInstallCommandBody {
  /** Токен регистрации; ровно одно из `token` и `tokenFile`. */
  token?: string;
  /** Путь к файлу с токеном на узле. */
  tokenFile?: string;
  /** Адрес сервера; без него — `AGENT_PUBLIC_URL` или `APP_PUBLIC_URL`. */
  baseUrl?: string;
  /** Имя агента (по умолчанию — имя машины). */
  name?: string;
}

export interface IAgentInstallCommandDto {
  /** `curl …/api/v1/agent-link/bundle/install.sh | sudo sh -s -- --server … --bundle … --token …`. */
  command: string;
}
