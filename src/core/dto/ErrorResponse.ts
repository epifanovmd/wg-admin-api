/** Тело любого ответа с ошибкой (`status >= 400`). */
export interface IErrorResponseDto {
  /** HTTP-статус. */
  status: number;
  /**
   * Машинный код: доменный (`USER_EMAIL_TAKEN`) или по статусу (`NOT_FOUND`,
   * `VALIDATION_ERROR`, `INTERNAL_ERROR`). Стабилен — на него опирается клиент.
   */
  code: string;
  /** Человекочитаемое сообщение; для 5xx — общее, без внутренних деталей. */
  message: string;
  /** Подробности: для VALIDATION_ERROR — поле → сообщение. */
  details?: unknown;
  /** Идентификатор запроса — для обращения в поддержку и поиска в логах. */
  requestId?: string;
  /** Stack trace — только вне production. */
  stack?: string;
}
