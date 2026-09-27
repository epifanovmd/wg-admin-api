import { BaseDto } from "../../../core";
import type { WgEndpoint } from "../wg-endpoint.entity";
import type { EWgEndpointMode, EWgForwardMode } from "../wg-endpoint.types";

export class WgEndpointDto extends BaseDto {
  id: string;
  name: string;
  description: string | null;
  host: string;
  mode: EWgEndpointMode;
  relayNodeId: string | null;
  forwardMode: EWgForwardMode;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: WgEndpoint) {
    super(entity);

    this.id = entity.id;
    this.name = entity.name;
    this.description = entity.description;
    this.host = entity.host;
    this.mode = entity.mode;
    this.relayNodeId = entity.relayNodeId;
    this.forwardMode = entity.forwardMode;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }

  static fromEntity(entity: WgEndpoint) {
    return new WgEndpointDto(entity);
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
