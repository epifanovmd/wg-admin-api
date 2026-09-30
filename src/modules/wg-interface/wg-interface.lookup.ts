import type { EventBus } from "../../core";
import type { AuthContext } from "../../types/koa";
import { WgInterfaceDto } from "./dto";
import { WgInterfaceUpdatedEvent } from "./events";
import { WgInterfaceAccess } from "./wg-interface.access";
import type { WgInterface } from "./wg-interface.entity";
import { WgInterfaceError } from "./wg-interface.errors";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import type { WgInterfaceRepository } from "./wg-interface.repository";
import type { EWgInterfaceStatus } from "./wg-interface.types";

/** Интерфейс со связями (нода, точка, реплики) или 404. */
export const findInterfaceOrFail = async (
  repo: WgInterfaceRepository,
  id: string,
): Promise<WgInterface> => {
  const iface = await repo.findWithRelations(id);

  if (!iface) throw WgInterfaceError.NOT_FOUND();

  return iface;
};

/**
 * Интерфейс со связями для действия актора: невидимый — 404, видимый без
 * права на действие — 403.
 */
export const findInterfaceFor = async (
  repo: WgInterfaceRepository,
  actor: AuthContext,
  id: string,
  permission: string,
): Promise<WgInterface> => {
  const iface = await findInterfaceOrFail(repo, id);

  if (
    !WgInterfaceAccess.can(actor, WgInterfacePermissions.INTERFACE_VIEW, iface)
  ) {
    throw WgInterfaceError.NOT_FOUND();
  }
  if (!WgInterfaceAccess.can(actor, permission, iface)) {
    throw WgInterfaceError.FORBIDDEN();
  }

  return iface;
};

/** Актуальный DTO интерфейса — в `WgInterfaceUpdatedEvent`. */
export const emitInterfaceUpdated = async (
  repo: WgInterfaceRepository,
  eventBus: EventBus,
  id: string,
  previousEndpointId: string | null = null,
  previousOwnerId: string | null = null,
): Promise<WgInterfaceDto> => {
  const dto = WgInterfaceDto.fromEntity(await findInterfaceOrFail(repo, id));

  eventBus.emit(
    new WgInterfaceUpdatedEvent(dto, previousEndpointId, previousOwnerId),
  );

  return dto;
};

/** Ноды всех копий интерфейса: основная и реплики. */
export const interfaceCopyNodes = (iface: WgInterface): string[] => [
  iface.nodeId,
  ...(iface.replicas ?? []).map(replica => replica.nodeId),
];

/** Статус интерфейса на копии: основная — сам интерфейс, иначе реплика. */
export const copyStatus = (
  iface: WgInterface,
  nodeId: string,
): EWgInterfaceStatus | null =>
  nodeId === iface.nodeId
    ? iface.status
    : (iface.replicas?.find(replica => replica.nodeId === nodeId)?.status ??
      null);
