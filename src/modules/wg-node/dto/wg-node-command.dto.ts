import { BaseDto } from "../../../core";
import type {
  EWgNodeCommandStatus,
  EWgNodeCommandType,
  IWgNodeCommandPayload,
} from "../wg-node.types";
import type { WgNodeCommand } from "../wg-node-command.entity";

export class WgNodeCommandDto extends BaseDto {
  id: string;
  nodeId: string;
  type: EWgNodeCommandType;
  status: EWgNodeCommandStatus;
  payload: IWgNodeCommandPayload;
  output: string;
  exitCode: number | null;
  error: string | null;
  requestedBy: string | null;
  timeoutSec: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;

  constructor(entity: WgNodeCommand) {
    super(entity);

    this.id = entity.id;
    this.nodeId = entity.nodeId;
    this.type = entity.type;
    this.status = entity.status;
    this.payload = entity.payload;
    this.output = entity.output;
    this.exitCode = entity.exitCode;
    this.error = entity.error;
    this.requestedBy = entity.requestedBy;
    this.timeoutSec = entity.timeoutSec;
    this.startedAt = entity.startedAt;
    this.finishedAt = entity.finishedAt;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: WgNodeCommand) {
    return new WgNodeCommandDto(entity);
  }
}

/** Журнал агента ноды (результат команды `agent-logs`). */
export interface IWgNodeLogsDto {
  content: string;
}
