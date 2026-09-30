import { inject } from "inversify";
import {
  Controller,
  Get,
  Path,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  WgNodeCommandDto,
  WgNodeCommandService,
  WgNodePermissions,
  WgNodeService,
} from "../wg-node";
import { WgAgentError } from "./wg-agent.errors";
import {
  normalizeArch,
  WG_AGENT_ARCHES,
  WgAgentBinaryService,
} from "./wg-agent-binary.service";

/** Доступная версия агента. */
export interface IWgAgentReleaseInfo {
  /** Версия; null — агент на бэкенде не собран. */
  version: string | null;
  /** sha256 бинарей по архитектурам: нода с другим `agentCodeHash` — к обновлению. */
  hashes: { amd64?: string; arm64?: string };
}

/** Обновление кода агентов без переустановки по SSH. */
@Injectable()
@Tags("WgAgentUpdate")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/agent")
export class WgAgentUpdateController extends Controller {
  constructor(
    @inject(WgAgentBinaryService)
    private readonly _binaries: WgAgentBinaryService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
  ) {
    super();
  }

  /**
   * Версия агента, которую бэкенд может раздать, и sha256 бинарей. Нода с
   * другим `agentCodeHash` для своей архитектуры — кандидат на обновление.
   * @summary Доступная версия агента
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get("release")
  async wgAgentRelease(): Promise<IWgAgentReleaseInfo> {
    const release = await this._binaries.release();
    const hashes: IWgAgentReleaseInfo["hashes"] = {};

    for (const arch of WG_AGENT_ARCHES) {
      const binary = release.binaries[arch];

      if (binary) hashes[arch] = binary.hash;
    }

    return { version: release.version, hashes };
  }

  /**
   * Обновить агента на ноде: агент скачает бинарь своей архитектуры,
   * сверит sha256 и перезапустится (не вышел на связь трижды — откат на
   * прежнюю версию). Архитектура ноды неизвестна или бинарь под неё не
   * собран — 404.
   * @summary Обновить агента
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @SuccessResponse(201, "Created")
  @Post("nodes/{nodeId}/update")
  async updateWgAgent(
    @Request() req: KoaRequest,
    @Path() nodeId: UUID,
  ): Promise<WgNodeCommandDto> {
    const actor = getContextUser(req);
    const node = await this._nodes.findFor(
      actor,
      nodeId,
      WgNodePermissions.NODE_AGENT,
    );
    const binary = await this._binaries.binary(
      normalizeArch(node.osInfo?.arch) ?? "",
    );

    if (!binary) throw WgAgentError.BINARY_NOT_BUILT();

    return this._commands.createAgentUpdate(nodeId, actor.userId, binary.hash);
  }
}
