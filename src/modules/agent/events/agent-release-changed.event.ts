import type { IAgentReleaseNoticeDto } from "../dto";

/** Агенты нашли новую версию агента (новейшая `update.latest` выросла). */
export class AgentReleaseChangedEvent {
  constructor(public readonly release: IAgentReleaseNoticeDto) {}
}
