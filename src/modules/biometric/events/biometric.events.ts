/** Пользователь зарегистрировал (или перерегистрировал) ключ устройства. */
export class BiometricAddedEvent {
  constructor(
    public readonly userId: string,
    public readonly deviceId: string,
    public readonly deviceName: string,
  ) {}
}

/** Пользователь удалил биометрическое устройство. */
export class BiometricRemovedEvent {
  constructor(
    public readonly userId: string,
    public readonly deviceId: string,
  ) {}
}
