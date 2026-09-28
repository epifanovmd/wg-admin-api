/** Запись пользователя создана или изменена (контакты, профиль, права). */
export class UserChangedEvent {
  constructor(public readonly userId: string) {}
}
