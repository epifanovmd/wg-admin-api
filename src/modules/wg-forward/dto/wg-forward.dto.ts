import { BaseDto } from "../../../core";
import { userDisplayName } from "../../user/user-name";
import type { WgForward } from "../wg-forward.entity";
import type {
  EWgForwardActiveRoute,
  EWgForwardPath,
  EWgForwardProtocol,
  EWgForwardRoute,
} from "../wg-forward.types";

export class WgForwardDto extends BaseDto {
  id: string;
  /** Назначенный владелец проброса. */
  ownerId: string | null;
  /** Отображаемое имя владельца. */
  ownerName: string | null;
  /** Создатель проброса. */
  createdById: string | null;
  /** Отображаемое имя создателя. */
  createdByName: string | null;
  name: string;
  description: string | null;
  relayNodeId: string;
  relayNodeName: string | null;
  protocol: EWgForwardProtocol;
  listenPort: number;
  targetNodeId: string | null;
  targetNodeName: string | null;
  targetHost: string | null;
  targetPort: number;
  path: EWgForwardPath;
  route: EWgForwardRoute;
  enabled: boolean;
  /** Маршрут по последнему отчёту агента релея; null — отчёта ещё нет. */
  activeRoute: EWgForwardActiveRoute | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(
    entity: WgForward,
    activeRoute: EWgForwardActiveRoute | null = null,
  ) {
    super(entity);

    this.id = entity.id;
    this.ownerId = entity.ownerId;
    this.ownerName = userDisplayName(entity.owner);
    this.createdById = entity.createdById;
    this.createdByName = userDisplayName(entity.createdBy);
    this.name = entity.name;
    this.description = entity.description;
    this.relayNodeId = entity.relayNodeId;
    this.relayNodeName = entity.relayNode?.name ?? null;
    this.protocol = entity.protocol;
    this.listenPort = entity.listenPort;
    this.targetNodeId = entity.targetNodeId;
    this.targetNodeName = entity.targetNode?.name ?? null;
    this.targetHost = entity.targetHost;
    this.targetPort = entity.targetPort;
    this.path = entity.path;
    this.route = entity.route;
    this.enabled = entity.enabled;
    this.activeRoute = activeRoute;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(
    entity: WgForward,
    activeRoute: EWgForwardActiveRoute | null = null,
  ) {
    return new WgForwardDto(entity, activeRoute);
  }
}
