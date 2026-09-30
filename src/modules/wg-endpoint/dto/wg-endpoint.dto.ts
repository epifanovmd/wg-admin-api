import { BaseDto } from "../../../core";
import { userDisplayName } from "../../user/user-name";
import type { IWgEndpointInterfaceDto } from "../endpoint-usage";
import type { WgEndpoint } from "../wg-endpoint.entity";
import type {
  EWgEndpointMode,
  EWgEndpointRoute,
  EWgForwardMode,
} from "../wg-endpoint.types";

export class WgEndpointDto extends BaseDto {
  id: string;
  /** Назначенный владелец точки. */
  ownerId: string | null;
  /** Отображаемое имя владельца. */
  ownerName: string | null;
  /** Создатель точки. */
  createdById: string | null;
  /** Отображаемое имя создателя. */
  createdByName: string | null;
  name: string;
  description: string | null;
  host: string;
  mode: EWgEndpointMode;
  relayNodeId: string | null;
  forwardMode: EWgForwardMode;
  /** Маршрут при IPIP: запасной прямой путь до той же ноды (`auto`) или нет. */
  route: EWgEndpointRoute;
  /** Интерфейсы, подключённые через точку, — куда она ведёт. */
  interfaces: IWgEndpointInterfaceDto[];
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgEndpoint, interfaces: IWgEndpointInterfaceDto[] = []) {
    super(entity);

    this.id = entity.id;
    this.ownerId = entity.ownerId;
    this.ownerName = userDisplayName(entity.owner);
    this.createdById = entity.createdById;
    this.createdByName = userDisplayName(entity.createdBy);
    this.name = entity.name;
    this.description = entity.description;
    this.host = entity.host;
    this.mode = entity.mode;
    this.relayNodeId = entity.relayNodeId;
    this.forwardMode = entity.forwardMode;
    this.route = entity.route;
    this.interfaces = interfaces;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(
    entity: WgEndpoint,
    interfaces: IWgEndpointInterfaceDto[] = [],
  ) {
    return new WgEndpointDto(entity, interfaces);
  }
}

/** Краткая запись для выпадающих списков. */
export class WgEndpointOptionDto extends BaseDto {
  id: string;
  name: string;
  host: string;
  mode: EWgEndpointMode;

  constructor(entity: WgEndpoint) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.host = entity.host;
    this.mode = entity.mode;
  }

  static fromEntity(entity: WgEndpoint) {
    return new WgEndpointOptionDto(entity);
  }
}
