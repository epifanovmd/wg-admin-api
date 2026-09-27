export interface ICreateWgInterfaceBody {
  nodeId: string;
  name: string;
  listenPort: number;
  /** Адрес интерфейса с подсетью пиров, например `10.0.0.1/24`. */
  addressCidr: string;
  addressV6Cidr?: string | null;
  dns?: string | null;
  mtu?: number | null;
  endpointId?: string | null;
  endpointPort?: number | null;
  natEnabled?: boolean;
  /** Только для суперпользователя. */
  customPostUp?: string | null;
  customPostDown?: string | null;
  enabled?: boolean;
}

export interface IUpdateWgInterfaceBody {
  name?: string;
  listenPort?: number;
  addressCidr?: string;
  addressV6Cidr?: string | null;
  dns?: string | null;
  mtu?: number | null;
  endpointId?: string | null;
  endpointPort?: number | null;
  natEnabled?: boolean;
  customPostUp?: string | null;
  customPostDown?: string | null;
  /**
   * Закрепить трафик через релей на копии (основная нода или нода реплики);
   * null — авто: основная, при недоступности — следующая по приоритету.
   */
  activeReplicaNodeId?: string | null;
}

/** Перенос интерфейса (с ключом и пирами) на другую ноду. */
export interface IMoveWgInterfaceBody {
  nodeId: string;
}

/** Копия интерфейса (реплика) на другой ноде. */
export interface IAddWgInterfaceReplicaBody {
  nodeId: string;
}
