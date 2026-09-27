import { randomBytes } from "node:crypto";

import { inject, multiInject, optional } from "inversify";
import { DataSource, EntityManager } from "typeorm";

import {
  EventBus,
  Injectable,
  isUniqueViolation,
  pgConstraint,
} from "../../core";
import type { IWgRelayConsumer } from "../wg-interface";
import { WG_RELAY_CONSUMER } from "../wg-interface";
import { WgNode, WgNodeService, WgSecretBox } from "../wg-node";
import { WgLiveStore } from "../wg-stats";
import type {
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
import { WgSocksService as WgSocksServiceEntity } from "./wg-socks.entity";
import { WgSocksError } from "./wg-socks.errors";
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
 * клиентские сертификаты. Любое изменение поднимает версию ноды — агент
 * перенастраивает сервер сам. Клиент для устройства — `WgSocksClientKitService`.
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
  async create(body: ICreateWgSocksBody): Promise<WgSocksServiceDto> {
    const node = await this._nodes.findEntity(body.nodeId);

    await this._assertPortFree(node, body.listenPort, undefined, true);

    const serverName = body.serverName ?? node.publicHost ?? node.name;
    const ca = await newCertificateAuthority(`${body.name}-ca`);
    const server = await issueCertificate(ca, serverName, "server");

    return this._saveNew({
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

  async list(): Promise<WgSocksServiceDto[]> {
    return Promise.all(
      (await this._services.findAllWithRelations()).map(service =>
        this._toDto(service),
      ),
    );
  }

  async get(id: string): Promise<WgSocksServiceDto> {
    return this._toDto(await this._findOrFail(id));
  }

  async update(
    id: string,
    body: IUpdateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    const service = await this._findOrFail(id);

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

    const { users: _u, clients: _c, node: _n, ...plain } = service;

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._services.target).save(plain),
    );

    return this._changed(id);
  }

  async delete(id: string): Promise<void> {
    const service = await this._findOrFail(id);

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._services.target).delete({ id }),
    );
    this._eventBus.emit(new WgSocksDeletedEvent(id));
  }

  /** Пользователь SOCKS5; без пароля — сгенерированный. */
  async addUser(
    serviceId: string,
    body: ICreateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findOrFail(serviceId);

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
    serviceId: string,
    userId: string,
    body: IUpdateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findOrFail(serviceId);
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

  async removeUser(serviceId: string, userId: string): Promise<void> {
    const service = await this._findOrFail(serviceId);

    if (!service.users?.some(user => user.id === userId)) {
      throw WgSocksError.USER_NOT_FOUND();
    }

    await this._inTxDirty(service.nodeId, manager =>
      manager.getRepository(this._users.target).delete({ id: userId }),
    );
    await this._changed(serviceId);
  }

  /** Пароль пользователя для ссылки Telegram (только manage). */
  async userSecret(
    serviceId: string,
    userId: string,
  ): Promise<IWgSocksUserSecretDto> {
    const service = await this._findOrFail(serviceId);
    const user = service.users?.find(item => item.id === userId);

    if (!user) throw WgSocksError.USER_NOT_FOUND();

    return {
      username: user.username,
      password: this._secrets.open(user.passwordEnc),
    };
  }

  /** Новый клиентский сертификат, подписанный CA прокси. */
  async issueClient(
    serviceId: string,
    body: ICreateWgSocksClientBody,
  ): Promise<WgSocksClientDto> {
    const service = await this._findOrFail(serviceId);

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
    serviceId: string,
    clientId: string,
  ): Promise<WgSocksClientDto> {
    const service = await this._findOrFail(serviceId);
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

    const own = new Set(
      (
        await this._services.find({ where: { nodeId }, select: { id: true } })
      ).map(service => service.id),
    );

    for (const stat of stats) {
      if (!own.has(stat.id)) continue;

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
        this._eventBus.emit(new WgSocksStatsEvent(stat.id, live));
      }
    }
  }

  /** Свежая карточка прокси после изменения — в событие и в ответ. */
  private async _changed(id: string): Promise<WgSocksServiceDto> {
    const dto = await this.get(id);

    this._eventBus.emit(new WgSocksUpdatedEvent(dto));

    return dto;
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
