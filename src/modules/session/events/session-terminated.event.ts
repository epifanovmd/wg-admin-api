import type { TSessionEndReason } from "../session.types";

export class SessionTerminatedEvent {
  constructor(
    public readonly sessionId: string,
    public readonly userId: string,
    public readonly reason: TSessionEndReason = "terminated",
  ) {}
}
