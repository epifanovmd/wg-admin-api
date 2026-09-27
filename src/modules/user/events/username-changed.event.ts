export class UsernameChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly username: string | null,
  ) {}
}
