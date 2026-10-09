import type { IAgentReleaseNoticeDto } from "../dto";

/** В удалённом источнике сборок агента появилась новая версия. */
export class AgentReleaseChangedEvent {
  constructor(public readonly release: IAgentReleaseNoticeDto) {}
}
