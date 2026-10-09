import type { IAgentReleaseNoticeDto } from "../dto";

/** В удалённом источнике выпуска агента появилась новая версия. */
export class AgentReleaseChangedEvent {
  constructor(public readonly release: IAgentReleaseNoticeDto) {}
}
