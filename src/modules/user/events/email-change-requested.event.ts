/** Запрошена смена email: код отправлен на новый адрес. */
export class EmailChangeRequestedEvent {
  constructor(
    public readonly userId: string,
    public readonly newEmail: string,
  ) {}
}
