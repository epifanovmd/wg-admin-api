import { inject } from "inversify";

import { config } from "../../config";
import { Injectable, JobQueue } from "../../core";
import type { AuthContext } from "../../types/koa";
import {
  EWgNodeStatus,
  WgNodePermissions,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import type {
  IProvisionWgNodeBody,
  IUninstallWgNodeBody,
  IWgProvisionStartedDto,
} from "./dto";
import { WgProvisionError } from "./wg-provision.errors";
import {
  IWgProvisionJobData,
  IWgUninstallJobData,
  WG_NODE_JOB_SCOPE,
  WG_PROVISION_QUEUE,
  WG_UNINSTALL_QUEUE,
} from "./wg-provision.types";

/** Постановка установки агента: секреты шифруются до записи в очередь. */
@Injectable()
export class WgProvisionService {
  constructor(
    @inject(JobQueue) private readonly _jobs: JobQueue,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
  ) {}

  async provision(
    actor: AuthContext,
    nodeId: string,
    body: IProvisionWgNodeBody,
  ): Promise<IWgProvisionStartedDto> {
    const actorId = actor.userId;
    const node = await this._nodes.findFor(
      actor,
      nodeId,
      WgNodePermissions.NODE_PROVISION,
    );
    const backendUrl = body.backendUrl ?? config.app.publicUrl;

    if (!body.privateKey && !body.password) {
      throw WgProvisionError.AUTH_REQUIRED();
    }
    if (!backendUrl) throw WgProvisionError.BACKEND_URL_REQUIRED();

    // Свежий ключ агента: прежний отзывается, VPS получает только новый.
    const { agentKey } = await this._nodes.reissueAgentKey(actorId, node.id);
    const data: IWgProvisionJobData = {
      nodeId: node.id,
      host: body.host,
      port: body.port ?? 22,
      username: body.username ?? "root",
      privateKeyEnc: body.privateKey
        ? this._secrets.seal(body.privateKey)
        : undefined,
      passwordEnc: body.password
        ? this._secrets.seal(body.password)
        : undefined,
      agentKeyEnc: this._secrets.seal(agentKey),
      backendUrl,
    };
    const jobId = await this._jobs.enqueue(WG_PROVISION_QUEUE, data, {
      track: true,
      title: `Установка агента: ${node.name}`,
      ownerId: actorId,
      singletonKey: `wg-provision:${node.id}`,
      scope: { type: WG_NODE_JOB_SCOPE, id: node.id },
    });

    if (!jobId) throw WgProvisionError.ALREADY_RUNNING();

    await this._nodes.setStatus(node.id, EWgNodeStatus.Provisioning);

    return { jobId };
  }

  /**
   * Удалить агента с VPS по SSH: агент откатывает созданное им, контейнер,
   * образ и конфигурация удаляются, ключ отзывается.
   */
  async uninstall(
    actor: AuthContext,
    nodeId: string,
    body: IUninstallWgNodeBody,
  ): Promise<IWgProvisionStartedDto> {
    const actorId = actor.userId;
    const node = await this._nodes.findFor(
      actor,
      nodeId,
      WgNodePermissions.NODE_PROVISION,
    );
    const data: IWgUninstallJobData = {
      nodeId: node.id,
      actorId,
      host: body.host,
      port: body.port ?? 22,
      username: body.username ?? "root",
      privateKeyEnc: body.privateKey
        ? this._secrets.seal(body.privateKey)
        : undefined,
      passwordEnc: body.password
        ? this._secrets.seal(body.password)
        : undefined,
    };
    const jobId = await this._jobs.enqueue(WG_UNINSTALL_QUEUE, data, {
      track: true,
      title: `Удаление агента: ${node.name}`,
      ownerId: actorId,
      singletonKey: `wg-uninstall:${node.id}`,
      scope: { type: WG_NODE_JOB_SCOPE, id: node.id },
    });

    if (!jobId) throw WgProvisionError.ALREADY_RUNNING();

    return { jobId };
  }
}
