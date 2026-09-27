import { PublicProfileDto } from "../dto";

export class ProfileUpdatedEvent {
  constructor(public readonly profile: PublicProfileDto) {}
}
