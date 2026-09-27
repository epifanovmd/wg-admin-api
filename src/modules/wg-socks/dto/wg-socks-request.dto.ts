export interface ICreateWgSocksBody {
  name: string;
  description?: string | null;
  nodeId: string;
  listenPort: number;
  /** Адрес для клиентов, если он не совпадает с нодой (проброс). */
  clientHost?: string | null;
  clientPort?: number | null;
  /** CN/SNI серверного сертификата (по умолчанию publicHost ноды). */
  serverName?: string;
}

export interface IUpdateWgSocksBody {
  name?: string;
  description?: string | null;
  listenPort?: number;
  /** Адрес для клиентов, если он не совпадает с нодой (проброс). */
  clientHost?: string | null;
  clientPort?: number | null;
  enabled?: boolean;
}

export interface ICreateWgSocksUserBody {
  username: string;
  /** Пусто — сгенерировать. */
  password?: string;
}

export interface IUpdateWgSocksUserBody {
  enabled?: boolean;
  /** Новый пароль. */
  password?: string;
}

export interface ICreateWgSocksClientBody {
  name: string;
}
