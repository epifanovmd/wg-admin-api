export class UserPrivilegesChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly roles: string[],
    public readonly permissions: string[],
  ) {}
}
