import { inject } from "inversify";

import { Injectable } from "../decorators";
import { AgentError } from "./agent.errors";
import {
  agentArchive,
  agentArchiveWithEnv,
  agentEnvText,
  IAgentArchiveInfo,
} from "./agent-archive";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AGENT_BUNDLE_PATH, agentPublicUrl } from "./agent-files";
import { IAgentIssueParams } from "./agent-issue.entity";
import { AgentIssueRepository } from "./agent-issue.repository";

const MINUTE_MS = 60_000;

/** Что выдать: токен с этими параметрами и `.env` (имя агента, адрес бэкенда). */
export interface IAgentIssueInput {
  /** Имя токена регистрации (в списке токенов). */
  tokenName: string;
  /** Имя агента (`AGENT_NAME`); нет — имя машины. */
  name?: string;
  /** Метки токена: их получит зарегистрированный агент. */
  labels?: Record<string, string>;
  /** Сколько раз можно использовать токен (по умолчанию 1). */
  maxUses?: number;
  /** Срок токена, мин. */
  tokenTtlMinutes: number;
  /** Адрес бэкенда для агента; нет — `AGENT_PUBLIC_URL`. */
  server?: string;
}

/** Выданный токен и `.env` с ним. */
export interface IAgentIssuedEnv {
  env: string;
  token: string;
  tokenId: string;
  expiresAt: Date;
}

/** Выданный архив с `.env`. */
export interface IAgentIssuedArchive {
  file: string;
  data: Buffer;
  tokenId: string;
  expiresAt: Date;
}

/** Одноразовая ссылка на архив с токеном. */
export interface IAgentIssuedLink {
  id: string;
  url: string;
  expiresAt: Date;
}

/** Что можно выдать: адрес бэкенда и архив агента (все платформы). */
export interface IAgentIssueOptions {
  server: string;
  archive: IAgentArchiveInfo | null;
}

/**
 * Выдача агента получателю: токен регистрации и `.env` с адресом и токеном — текстом, внутри
 * архива для узлов (тот же архив, что раздаётся всем, и `.env`; на сервере не хранится) или
 * одноразовой ссылкой на такой архив (токен создаётся при скачивании). Метки (например,
 * привязку к сущности проекта) задаёт вызывающий модуль.
 */
@Injectable()
export class AgentIssueService {
  constructor(
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
    @inject(AgentIssueRepository)
    private readonly _issues: AgentIssueRepository,
  ) {}

  async options(): Promise<IAgentIssueOptions> {
    return { server: agentPublicUrl(), archive: await agentArchive() };
  }

  /** Токен и `.env` с ним. */
  async env(
    createdBy: string | null,
    input: IAgentIssueInput,
  ): Promise<IAgentIssuedEnv> {
    const server = this.server(input.server);
    const issued = await this.token(createdBy, input);

    return {
      env: agentEnvText({ server, token: issued.token, name: input.name }),
      ...issued,
    };
  }

  /** Архив агента (все платформы) с `.env` (токен — в нём). */
  async archive(
    createdBy: string | null,
    input: IAgentIssueInput,
  ): Promise<IAgentIssuedArchive> {
    await this.requireArchive();
    const server = this.server(input.server);
    const issued = await this.token(createdBy, input);
    const archive = await agentArchiveWithEnv({
      server,
      token: issued.token,
      name: input.name,
    });

    if (!archive) {
      await this._enrollment.revokeToken(issued.tokenId);
      throw AgentError.ARCHIVE_NOT_FOUND();
    }

    return { ...archive, tokenId: issued.tokenId, expiresAt: issued.expiresAt };
  }

  /**
   * Одноразовая ссылка на архив с токеном, до `linkTtlMinutes`: токен создаётся при
   * скачивании, срок токена — от скачивания.
   */
  async link(
    createdBy: string | null,
    input: IAgentIssueInput,
    linkTtlMinutes: number,
  ): Promise<IAgentIssuedLink> {
    await this.requireArchive();
    const server = this.server(input.server);
    const params: IAgentIssueParams = {
      tokenName: input.tokenName,
      name: input.name,
      labels: input.labels ?? {},
      maxUses: input.maxUses ?? 1,
      tokenTtlMinutes: input.tokenTtlMinutes,
      server,
    };
    const issue = await this._issues.createAndSave({
      params,
      createdBy,
      expiresAt: new Date(Date.now() + linkTtlMinutes * MINUTE_MS),
      downloadedAt: null,
      tokenId: null,
    });

    return {
      id: issue.id,
      url: `${agentPublicUrl()}${AGENT_BUNDLE_PATH}/issued/${issue.id}`,
      expiresAt: issue.expiresAt,
    };
  }

  /**
   * Скачать по одноразовой ссылке: архив с новым токеном; `null` — ссылки нет, она уже
   * скачана или истекла.
   */
  async download(id: string): Promise<{ file: string; data: Buffer } | null> {
    const issue = await this._issues.claim(id, new Date());

    if (!issue) return null;
    try {
      const archive = await this.archive(issue.createdBy, issue.params);

      await this._issues.setToken(issue.id, archive.tokenId);

      return { file: archive.file, data: archive.data };
    } catch (err) {
      await this._issues.release(issue.id);
      throw err;
    }
  }

  private server(server: string | undefined): string {
    return (server || agentPublicUrl()).replace(/\/+$/, "");
  }

  private async requireArchive(): Promise<void> {
    if (!(await agentArchive())) {
      throw AgentError.ARCHIVE_NOT_FOUND();
    }
  }

  private async token(
    createdBy: string | null,
    input: IAgentIssueInput,
  ): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + input.tokenTtlMinutes * MINUTE_MS);
    const created = await this._enrollment.createToken(createdBy, {
      name: input.tokenName.slice(0, 100),
      labels: input.labels ?? {},
      maxUses: input.maxUses ?? 1,
      expiresAt,
    });

    return {
      token: created.token,
      tokenId: created.enrollmentToken.id,
      expiresAt,
    };
  }
}
