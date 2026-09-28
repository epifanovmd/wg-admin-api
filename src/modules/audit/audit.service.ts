import { inject } from "inversify";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import {
  decodeCursor,
  encodeCursor,
  EventBus,
  ICursorPageDto,
  Injectable,
  logger,
  normalizePagination,
} from "../../core";
import { AuditEventDto } from "./audit.dto";
import { AuditError } from "./audit.errors";
import { AuditRepository, IAuditCursor } from "./audit.repository";
import { AUDIT_RETENTION_DAYS, IAuditEntry, IAuditFilter } from "./audit.types";
import type { AuditEvent } from "./audit-event.entity";
import { AuditRecordedEvent } from "./events";

const MS_IN_DAY = 86_400_000;

const clip = (value: string | null | undefined, max: number) =>
  value ? value.slice(0, max) : null;

const parseCursor = (cursor?: string): IAuditCursor | undefined => {
  if (!cursor) return undefined;

  const raw = decodeCursor<{ t?: string; id?: string }>(cursor);
  const createdAt = raw?.t ? new Date(raw.t) : undefined;

  if (!createdAt || Number.isNaN(createdAt.getTime()) || !raw?.id) {
    throw AuditError.INVALID_CURSOR();
  }

  return { createdAt, id: raw.id };
};

/**
 * Журнал событий безопасности. Запись не бросает исключений: сбой БД
 * пишется в лог и не ломает сценарий, породивший событие.
 */
@Injectable()
export class AuditService {
  constructor(
    @inject(AuditRepository) private readonly _repo: AuditRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Записать событие (эмитит `AuditRecordedEvent`); ошибка — только в лог. */
  async record(entry: IAuditEntry): Promise<void> {
    const row = {
      type: entry.type,
      actorId: entry.actorId ?? null,
      subjectId: clip(entry.subjectId, 255),
      ip: clip(entry.ip, 45),
      userAgent: clip(entry.userAgent, 500),
      meta: entry.meta ?? {},
    };

    try {
      const result = await this._repo.insert({
        ...row,
        meta: row.meta as QueryDeepPartialEntity<AuditEvent["meta"]>,
      });
      const saved = { ...row, ...result.generatedMaps[0] } as AuditEvent;

      this._eventBus.emit(
        new AuditRecordedEvent(AuditEventDto.fromEntity(saved)),
      );
    } catch (err) {
      logger.error({ err, type: entry.type }, "[Audit] Write failed");
    }
  }

  /** Лента событий по фильтру, новые — первыми, курсорная пагинация. */
  async list(
    filter: IAuditFilter,
    cursor?: string,
    limit?: number,
  ): Promise<ICursorPageDto<AuditEventDto>> {
    const page = normalizePagination(0, limit);
    const rows = await this._repo.findFeed(
      filter,
      page.limit,
      parseCursor(cursor),
    );
    const items = rows.slice(0, page.limit);
    const last = items[items.length - 1];

    return {
      items: items.map(AuditEventDto.fromEntity),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Удалить события старше срока хранения. */
  cleanup(now = new Date()): Promise<number> {
    return this._repo.deleteOlderThan(
      new Date(now.getTime() - AUDIT_RETENTION_DAYS * MS_IN_DAY),
    );
  }
}
