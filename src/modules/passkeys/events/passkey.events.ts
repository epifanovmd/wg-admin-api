/** Пользователь зарегистрировал passkey. */
export class PasskeyAddedEvent {
  constructor(
    public readonly userId: string,
    public readonly passkeyId: string,
  ) {}
}

/** Пользователь удалил passkey. */
export class PasskeyRemovedEvent {
  constructor(
    public readonly userId: string,
    public readonly passkeyId: string,
  ) {}
}
