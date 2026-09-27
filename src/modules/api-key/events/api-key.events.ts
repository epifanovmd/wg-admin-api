/** API-ключ выпущен (секрет в событие не попадает). */
export class ApiKeyCreatedEvent {
  constructor(
    public readonly apiKeyId: string,
    public readonly ownerId: string,
    public readonly name: string,
    public readonly scopes: string[],
  ) {}
}

/** API-ключ отозван. */
export class ApiKeyRevokedEvent {
  constructor(
    public readonly apiKeyId: string,
    public readonly revokedBy: string | undefined,
  ) {}
}
