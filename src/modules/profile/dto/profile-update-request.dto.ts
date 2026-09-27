export interface IProfileUpdateRequestDto {
  /** @maxLength 40 */
  firstName?: string | null;
  /** @maxLength 40 */
  lastName?: string | null;
  birthDate?: Date | null;
  /** @maxLength 20 */
  gender?: string | null;
  /**
   * Язык пользователя: `ru`, `en`, `en-US`. Письма — на `ru`/`en`, прочие
   * языки получают письма на `ru`.
   * @maxLength 10
   */
  locale?: string | null;
}
