export class PasswordChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly method: "change" | "reset",
    /** Сессия, из которой меняли пароль: её не завершать, остальные — завершить. */
    public readonly currentSessionId?: string,
  ) {}
}
