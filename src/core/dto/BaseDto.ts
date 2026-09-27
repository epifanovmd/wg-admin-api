import { HttpException } from "../http";
import { logger } from "../logger/logger.service";

export abstract class BaseDto {
  protected constructor(entity: any) {
    if (!entity) {
      const error = new HttpException(
        `[${this.constructor.name}] Cannot create DTO: entity is undefined`,
        500,
      );

      logger.error({ err: error }, error.message);

      throw error;
    }
  }
}
