export interface ICreateWgNodeBody {
  name: string;
  description?: string | null;
  /** Публичный хост (IP/домен) — endpoint клиентов по умолчанию. */
  publicHost?: string | null;
}

export interface IUpdateWgNodeBody {
  name?: string;
  description?: string | null;
  publicHost?: string | null;
}
