/** Email пользователя сменён после подтверждения кодом. */
export class EmailChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly oldEmail: string | null,
    public readonly newEmail: string,
  ) {}
}
