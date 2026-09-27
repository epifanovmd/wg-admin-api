export const BOOTSTRAP = Symbol("Bootstrap");

export interface IBootstrap {
  /**
   * Сбой критичного бутстрапера прерывает запуск. `false` — сбой только
   * логируется (сиды, фоновые задачи), приложение продолжает стартовать.
   * По умолчанию — критичный.
   */
  readonly critical?: boolean;
  initialize(): Promise<void>;
  destroy?(): Promise<void>;
}
