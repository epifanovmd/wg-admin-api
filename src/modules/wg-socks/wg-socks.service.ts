import { randomBytes } from "node:crypto";

import { inject, multiInject, optional } from "inversify";
import { DataSource, EntityManager } from "typeorm";

import {
  EventBus,
  Injectable,
  isUniqueViolation,
  PG_ERROR,
  pgConstraint,
  pgErrorCode,
} from "../../core";
import type { AuthContext } from "../../types/koa";
import type { IWgRelayConsumer } from "../wg-interface";
import { WG_RELAY_CONSUMER } from "../wg-interface";
import {
  WgNode,
  WgNodePermissions,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import { WgLiveStore } from "../wg-stats";
import type {
  IAssignWgSocksBody,
  ICreateWgSocksBody,
  ICreateWgSocksClientBody,
  ICreateWgSocksUserBody,
  IUpdateWgSocksBody,
  IUpdateWgSocksUserBody,
  IWgSocksLive,
  IWgSocksUserSecretDto,
} from "./dto";
import { WgSocksClientDto, WgSocksServiceDto } from "./dto";
import {
  WgSocksDeletedEvent,
  WgSocksStatsEvent,
  WgSocksUpdatedEvent,
} from "./events";
import { WgSocksAccess } from "./wg-socks.access";
import { WgSocksService as WgSocksServiceEntity } from "./wg-socks.entity";
import { WgSocksError } from "./wg-socks.errors";
import { findSocksFor } from "./wg-socks.lookup";
import { WgSocksPermissions } from "./wg-socks.permissions";
import {
  WgSocksClientRepository,
  WgSocksServiceRepository,
  WgSocksUserRepository,
} from "./wg-socks.repository";
import {
  certFingerprint,
  hashSocksPassword,
  issueCertificate,
  newCertificateAuthority,
} from "./wg-socks-pki";

const LIVE_TTL_SEC = 60;
const liveKey = (id: string): string => `socks:${id}`;

/** SOCKS5-прокси для desired state агента. */
export interface IWgSocksAgentConfig {
  id: string;
  listenPort: number;
  certPem: string;
  keyPem: string;
  caPem: string;
  /** SHA-256 допущенных клиентских сертификатов (отозванные — исключены). */
  allowedFingerprints: string[];
  users: Array<{ username: string; salt: string; hash: string }>;
}

/**
 * Прокси-сервисы: SOCKS5 через mTLS на нодах — сервис, пользователи,
 * клиентские сертификаты — с областью прав «все / свои» (владелец или
 * создатель): чужой прокси без права на все не раскрывается (404), видимый
 * без права на действие — 403; нода прокси — только видимая автору. Любое
 * изменение поднимает версию ноды — агент перенастраивает сервер сам. Клиент
 * для устройства — `WgSocksClientKitService`.
 */
@Injectable()
export class WgSocksAppService {
  constructor(
    @inject(WgSocksServiceRepository)
    private readonly _services: WgSocksServiceRepository,
    @inject(WgSocksUserRepository)
    private readonly _users: WgSocksUserRepository,
    @inject(WgSocksClientRepository)
    private readonly _clients: WgSocksClientRepository,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
    @inject(DataSource) private readonly _dataSource: DataSource,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @multiInject(WG_RELAY_CONSUMER)
    @optional()
    private readonly _consumers: IWgRelayConsumer[] | undefined = [],
  ) {}

  /** Новый прокси со своим CA и серверным сертификатом. */
  async create(
    actor: AuthContext,
    body: ICreateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    const ownerId = body.ownerId ?? null;

    if (
      ownerId !== null &&
      ownerId !== actor.userId &&
      !WgSocksAccess.scope(actor, WgSocksPermissions.SOCKS_ASSIGN)
    ) {
      throw WgSocksError.FORBIDDEN();
    }

    const node = await this._nodes.findFor(
      actor,
      body.nodeId,
      WgNodePermissions.NODE_VIEW,
    );

    await this._assertPortFree(node, body.listenPort, undefined, true);

    const serverName = body.serverName ?? node.publicHost ?? node.name;
    const ca = await newCertificateAuthority(`${body.name}-ca`);
    const server = await issueCertificate(ca, serverName, "server");

    return this._saveNew({
      ownerId,
      createdById: actor.userId,
      name: body.name,
      description: body.description ?? null,
      nodeId: node.id,
      listenPort: body.listenPort,
      clientHost: body.clientHost ?? null,
      clientPort: body.clientPort ?? null,
      serverName,
      caCertPem: ca.certPem,
      caKeyEnc: this._secrets.seal(ca.keyPem),
      serverCertPem: server.certPem,
      serverKeyEnc: this._secrets.seal(server.keyPem),
    });
  }

  /** Прокси в рамках прав; `mine` — только свои при любой области. */
  async list(actor: AuthContext, mine?: boolean): Promise<WgSocksServiceDto[]> {
    const filter = WgSocksAccess.listFilter(
      actor,
      WgSocksPermissions.SOCKS_VIEW,
      mine,
    );

    if (!filter) throw WgSocksError.FORBIDDEN();

    return Promise.all(
      (await this._services.findAllWithRelations(filter.ownedBy)).map(service =>
        this._toDto(service),
      ),
    );
  }

  async get(actor: AuthContext, id: string): Promise<WgSocksServiceDto> {
    return this._toDto(
      await this._findFor(actor, id, WgSocksPermissions.SOCKS_VIEW),
    );
  }

  async update(
    actor: AuthContext,
    id: string,
    body: IUpdateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    const service = await this._findFor(
      actor,
      id,
      WgSocksPermissions.SOCKS_UPDATE,
    );

    if (
      body.listenPort !== undefined &&
      body.listenPort !== service.listenPort
    ) {
      await this._assertPortFree(
        service.node!,
        body.listenPort,
        service.id,
        true,
      );
      service.listenPort = body.listenPort;
    }
    if (body.name !== undefined) service.name = body.name;
    if (body.clientHost !== undefined) service.clientHost = body.clientHost;
    if (body.clientPort !== undefined) service.clientPort = body.clientPort;
    if (body.description !== undefined) service.description = body.description;
    if (body.enabled !== undefined) service.enabled = body.enabled;

    const {
      users: _u,
      clients: _c,
      node: _n,
      owner: _o,
      createdBy: _cb,
      ...plain
    } = service;

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._services.target).save(plain),
    );

    return this._changed(id);
  }

  async delete(actor: AuthContext, id: string): Promise<void> {
    const service = await this._findFor(
      actor,
      id,
      WgSocksPermissions.SOCKS_DELETE,
    );

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._services.target).delete({ id }),
    );
    this._eventBus.emit(
      new WgSocksDeletedEvent(id, service.ownerId, service.createdById),
    );
  }

  /** Назначить владельца прокси. */
  async assign(
    actor: AuthContext,
    id: string,
    body: IAssignWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    const service = await this._findFor(
      actor,
      id,
      WgSocksPermissions.SOCKS_ASSIGN,
    );

    try {
      await this._services.update({ id }, { ownerId: body.userId });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgSocksError.OWNER_NOT_FOUND();
      }
      throw err;
    }

    return this._changed(id, this._previousOwner(service, body.userId));
  }

  /** Снять владельца прокси. */
  async revoke(actor: AuthContext, id: string): Promise<WgSocksServiceDto> {
    const service = await this._findFor(
      actor,
      id,
      WgSocksPermissions.SOCKS_ASSIGN,
    );

    await this._services.update({ id }, { ownerId: null });

    return this._changed(id, this._previousOwner(service, null));
  }

  /** Пользователь SOCKS5; без пароля — сгенерированный. */
  async addUser(
    actor: AuthContext,
    serviceId: string,
    body: ICreateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_USERS,
    );

    if (service.users?.some(user => user.username === body.username)) {
      throw WgSocksError.USERNAME_TAKEN();
    }

    const password = body.password ?? randomBytes(12).toString("base64url");
    const hashed = await hashSocksPassword(password);

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._users.target).save({
        serviceId,
        username: body.username,
        passwordEnc: this._secrets.seal(password),
        passwordSalt: hashed.salt,
        passwordHash: hashed.hash,
      }),
    );
    await this._changed(serviceId);

    return { username: body.username, password };
  }

  async updateUser(
    actor: AuthContext,
    serviceId: string,
    userId: string,
    body: IUpdateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_USERS,
    );
    const user = service.users?.find(item => item.id === userId);

    if (!user) throw WgSocksError.USER_NOT_FOUND();
    if (body.enabled !== undefined) user.enabled = body.enabled;
    if (body.password !== undefined) {
      const hashed = await hashSocksPassword(body.password);

      user.passwordEnc = this._secrets.seal(body.password);
      user.passwordSalt = hashed.salt;
      user.passwordHash = hashed.hash;
    }

    const { service: _s, ...plain } = user;

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._users.target).save(plain),
    );
    await this._changed(serviceId);

    return {
      username: user.username,
      password: this._secrets.open(user.passwordEnc),
    };
  }

  async removeUser(
    actor: AuthContext,
    serviceId: string,
    userId: string,
  ): Promise<void> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_USERS,
    );

    if (!service.users?.some(user => user.id === userId)) {
      throw WgSocksError.USER_NOT_FOUND();
    }

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._users.target).delete({ id: userId }),
    );
    await this._changed(serviceId);
  }

  /** Пароль пользователя для ссылки Telegram (право secrets). */
  async userSecret(
    actor: AuthContext,
    serviceId: string,
    userId: string,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_SECRETS,
    );
    const user = service.users?.find(item => item.id === userId);

    if (!user) throw WgSocksError.USER_NOT_FOUND();

    return {
      username: user.username,
      password: this._secrets.open(user.passwordEnc),
    };
  }

  /** Новый клиентский сертификат, подписанный CA прокси. */
  async issueClient(
    actor: AuthContext,
    serviceId: string,
    body: ICreateWgSocksClientBody,
  ): Promise<WgSocksClientDto> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_CLIENTS,
    );

    const issued = await issueCertificate(
      {
        certPem: service.caCertPem,
        keyPem: this._secrets.open(service.caKeyEnc),
      },
      body.name,
      "client",
    );
    const saved = await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._clients.target).save({
        serviceId,
        name: body.name,
        certPem: issued.certPem,
        keyEnc: this._secrets.seal(issued.keyPem),
        fingerprint: certFingerprint(issued.certPem),
      }),
    );

    await this._changed(serviceId);

    return WgSocksClientDto.fromEntity(saved);
  }

  /** Отзыв: агент сразу перестаёт пускать сертификат. */
  async revokeClient(
    actor: AuthContext,
    serviceId: string,
    clientId: string,
  ): Promise<WgSocksClientDto> {
    const service = await this._findFor(
      actor,
      serviceId,
      WgSocksPermissions.SOCKS_CLIENTS,
    );
    const client = service.clients?.find(item => item.id === clientId);

    if (!client) throw WgSocksError.CLIENT_NOT_FOUND();

    client.revoked = true;

    const { service: _s, ...plain } = client;

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._clients.target).save(plain),
    );
    await this._changed(serviceId);

    return WgSocksClientDto.fromEntity(client);
  }

  /** Конфигурация прокси ноды для агента. */
  async agentConfigs(nodeId: string): Promise<IWgSocksAgentConfig[]> {
    return (await this._services.findActiveByNode(nodeId)).map(service => ({
      id: service.id,
      listenPort: service.listenPort,
      certPem: service.serverCertPem,
      keyPem: this._secrets.open(service.serverKeyEnc),
      caPem: service.caCertPem,
      allowedFingerprints: (service.clients ?? [])
        .filter(client => !client.revoked)
        .map(client => client.fingerprint),
      users: (service.users ?? [])
        .filter(user => user.enabled)
        .map(user => ({
          username: user.username,
          salt: user.passwordSalt,
          hash: user.passwordHash,
        })),
    }));
  }

  /** Отчёт агента: подключения и трафик прокси ноды. */
  async recordStats(
    nodeId: string,
    stats: Array<{
      id: string;
      connections: number;
      rxBytes: number;
      txBytes: number;
    }>,
  ): Promise<void> {
    if (stats.length === 0) return;

    const onNode = new Map(
      (
        await this._services.find({
          where: { nodeId },
          select: { id: true, ownerId: true, createdById: true },
        })
      ).map(service => [service.id, service]),
    );

    for (const stat of stats) {
      const service = onNode.get(stat.id);

      if (!service) continue;

      const previous = await this._live.getJson<IWgSocksLive>(liveKey(stat.id));
      const live: IWgSocksLive = {
        connections: stat.connections,
        rxBytes: stat.rxBytes,
        txBytes: stat.txBytes,
        ts: new Date().toISOString(),
      };

      await this._live.setJson(liveKey(stat.id), live, LIVE_TTL_SEC);
      // Простаивающий прокси не шлёт одно и то же каждые несколько секунд.
      if (
        previous?.connections !== live.connections ||
        previous.rxBytes !== live.rxBytes ||
        previous.txBytes !== live.txBytes
      ) {
        this._eventBus.emit(
          new WgSocksStatsEvent(
            stat.id,
            live,
            service.ownerId,
            service.createdById,
          ),
        );
      }
    }
  }

  /** Свежая карточка прокси после изменения — в событие и в ответ. */
  private async _changed(
    id: string,
    previousOwnerId: string | null = null,
  ): Promise<WgSocksServiceDto> {
    const dto = await this._toDto(await this._findOrFail(id));

    this._eventBus.emit(new WgSocksUpdatedEvent(dto, previousOwnerId));

    return dto;
  }

  private _previousOwner(
    service: WgSocksServiceEntity,
    ownerId: string | null,
  ): string | null {
    return service.ownerId !== ownerId ? service.ownerId : null;
  }

  private _findFor(
    actor: AuthContext,
    id: string,
    permission: string,
  ): Promise<WgSocksServiceEntity> {
    return findSocksFor(this._services, actor, id, permission);
  }

  private async _toDto(
    service: WgSocksServiceEntity,
  ): Promise<WgSocksServiceDto> {
    return WgSocksServiceDto.fromEntity(
      service,
      await this._live.getJson<IWgSocksLive>(liveKey(service.id)),
    );
  }

  private async _saveNew(
    data: Partial<WgSocksServiceEntity>,
  ): Promise<WgSocksServiceDto> {
    try {
      const saved = await this._inTxDirty(data.nodeId!, manager =>
        manager.getRepository(this._services.target).save(data),
      );

      return await this._changed(saved.id);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION && data.ownerId) {
        throw WgSocksError.OWNER_NOT_FOUND();
      }
      if (!isUniqueViolation(err)) throw err;
      throw pgConstraint(err) === "IDX_WG_SOCKS_NAME"
        ? WgSocksError.NAME_TAKEN()
        : WgSocksError.PORT_TAKEN();
    }
  }

  /** Изменение и версия ноды — в одной транзакции. */
  private _inTxDirty<T>(
    nodeId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this._dataSource.transaction(async manager => {
      const result = await work(manager);

      await this._nodes.markDirty(nodeId, manager);

      return result;
    });
  }

  /**
   * TCP-порт на ноде: пробросы и другие прокси (занятые порты модулей) и —
   * при создании или смене порта — процессы хоста по отчёту агента.
   */
  private async _assertPortFree(
    node: WgNode,
    port: number,
    excludeId: string | undefined,
    checkHost: boolean,
  ): Promise<void> {
    for (const consumer of this._consumers ?? []) {
      const claims = await consumer.claimedPorts(node.id);

      if (
        claims.some(
          claim =>
            claim.protocol === "tcp" &&
            claim.port === port &&
            claim.ownerId !== excludeId,
        )
      ) {
        throw WgSocksError.PORT_TAKEN();
      }
    }
    if (checkHost && node.osInfo?.tcpPorts?.includes(port)) {
      throw WgSocksError.PORT_TAKEN();
    }
  }

  private async _findOrFail(id: string): Promise<WgSocksServiceEntity> {
    const service = await this._services.findWithRelations(id);

    if (!service) throw WgSocksError.NOT_FOUND();

    return service;
  }
}
