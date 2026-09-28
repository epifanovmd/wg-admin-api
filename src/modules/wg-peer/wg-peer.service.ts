import { inject } from "inversify";
import QRCode from "qrcode";
import { DataSource } from "typeorm";

import type { IPaginatedDto, Pagination } from "../../core";
import {
  EventBus,
  hasPermission,
  Injectable,
  isUniqueViolation,
  PG_ERROR,
  pgConstraint,
  pgErrorCode,
  toPage,
} from "../../core";
import { isSuperUser } from "../../core/auth/user-context";
import type { AuthContext } from "../../types/koa";
import { resolveClientEndpoint, WgInterfaceService } from "../wg-interface";
import {
  generateWgKeyPair,
  generateWgPresharedKey,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import type {
  IAssignWgPeerBody,
  ICreateWgPeerBody,
  IUpdateWgPeerBody,
  IWgPeerQrDto,
} from "./dto";
import { WgPeerDto, WgPeerOptionDto } from "./dto";
import {
  WgPeerCreatedEvent,
  WgPeerDeletedEvent,
  WgPeerUpdatedEvent,
} from "./events";
import { buildWgClientConfig, wgConfigFileName } from "./wg-client-config";
import { allocatePeerIpv4, derivePeerIpv6 } from "./wg-ip-allocator";
import { WgPeer } from "./wg-peer.entity";
import { WgPeerError } from "./wg-peer.errors";
import { WgPeerPermissions } from "./wg-peer.permissions";
import type { IWgPeerFilters } from "./wg-peer.repository";
import { WgPeerRepository } from "./wg-peer.repository";
import {
  EWgPeerDisabledReason,
  WG_PEER_DEFAULT_CLIENT_ALLOWED_IPS,
  WG_PEER_DEFAULT_KEEPALIVE,
} from "./wg-peer.types";

/** Обновление пира из статистики агента (батч, с deadband). */
export interface IWgPeerStatsUpdate {
  peerId: string;
  lastHandshakeAt: Date | null;
  lastEndpoint: string | null;
  rxBytesTotal: number;
  txBytesTotal: number;
}

/** Пир для серверного конфига интерфейса (desired state агента). */
export interface IWgServerPeer {
  publicKey: string;
  presharedKey: string | null;
  /** AllowedIPs на сервере: адреса пира. */
  allowedIps: string;
}

/** Готовый клиентский конфиг. */
export interface IWgPeerConfig {
  fileName: string;
  content: string;
}

const CREATE_ATTEMPTS = 3;

/** Пиры: CRUD с own-scope, конфиги/QR, PSK, назначение, срок действия. */
@Injectable()
export class WgPeerService {
  constructor(
    @inject(WgPeerRepository) private readonly _repo: WgPeerRepository,
    @inject(WgInterfaceService)
    private readonly _interfaces: WgInterfaceService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(DataSource) private readonly _dataSource: DataSource,
  ) {}

  async create(
    actor: AuthContext,
    body: ICreateWgPeerBody,
  ): Promise<WgPeerDto> {
    const iface = await this._interfaces.findEntity(body.interfaceId);
    const imported = Boolean(body.publicKey);
    const keys = imported ? null : generateWgKeyPair();
    const publicKey = body.publicKey ?? keys!.publicKey;
    const withPsk = body.withPresharedKey ?? true;

    for (let attempt = 1; ; attempt += 1) {
      const used = await this._repo.usedAddresses(iface.id);
      const addressV4 = allocatePeerIpv4(iface.addressCidr, used);

      if (!addressV4) throw WgPeerError.SUBNET_FULL();

      try {
        const created = await this._dataSource.transaction(async manager => {
          const saved = await this._repo.getRepository(manager).save({
            interfaceId: iface.id,
            userId: body.userId ?? null,
            name: body.name,
            description: body.description ?? null,
            publicKey,
            privateKeyEnc: keys ? this._secrets.seal(keys.privateKey) : null,
            presharedKeyEnc: withPsk
              ? this._secrets.seal(generateWgPresharedKey())
              : null,
            addressV4,
            addressV6: derivePeerIpv6(
              iface.addressV6Cidr,
              iface.addressCidr,
              addressV4,
            ),
            clientAllowedIPs:
              body.clientAllowedIPs ?? WG_PEER_DEFAULT_CLIENT_ALLOWED_IPS,
            clientDns: body.clientDns ?? null,
            clientMtu: body.clientMtu ?? null,
            persistentKeepalive:
              body.persistentKeepalive ?? WG_PEER_DEFAULT_KEEPALIVE,
            enabled: body.enabled ?? true,
            disabledReason:
              (body.enabled ?? true) ? null : EWgPeerDisabledReason.Manual,
            expiresAt: body.expiresAt ?? null,
          });

          await this._interfaces.markInterfaceDirty(iface.id, manager);

          return saved;
        });

        const dto = await this._dtoWithRelations(created.id);

        this._eventBus.emit(new WgPeerCreatedEvent(dto));

        return dto;
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
          throw WgPeerError.USER_NOT_FOUND();
        }

        const mapped = this._mapCreateError(err);

        // Гонка за адрес — повторить выделение.
        if (
          mapped === WgPeerError.codes.ADDRESS_TAKEN &&
          attempt < CREATE_ATTEMPTS
        ) {
          continue;
        }
        if (typeof mapped === "string") {
          throw this._errorByCode(mapped);
        }
        throw err;
      }
    }
  }

  async list(
    actor: AuthContext,
    filters: IWgPeerFilters,
    pagination: Pagination,
  ): Promise<IPaginatedDto<WgPeerDto>> {
    const scoped = this._scopeFilters(actor, filters);
    const [items, total] = await this._repo.findPage(scoped, pagination);

    return toPage(items.map(WgPeerDto.fromEntity), total, pagination);
  }

  async options(actor: AuthContext): Promise<WgPeerOptionDto[]> {
    const scoped = this._scopeFilters(actor, {});
    const items = await this._repo.find({
      where: scoped.userId ? { userId: scoped.userId } : {},
      order: { name: "ASC" },
    });

    return items.map(WgPeerOptionDto.fromEntity);
  }

  async get(actor: AuthContext, id: string): Promise<WgPeerDto> {
    return WgPeerDto.fromEntity(await this._findScoped(actor, id));
  }

  async update(id: string, body: IUpdateWgPeerBody): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);

    if (body.name !== undefined) peer.name = body.name;
    if (body.description !== undefined) peer.description = body.description;
    if (body.clientAllowedIPs !== undefined) {
      peer.clientAllowedIPs = body.clientAllowedIPs;
    }
    if (body.clientDns !== undefined) peer.clientDns = body.clientDns;
    if (body.clientMtu !== undefined) peer.clientMtu = body.clientMtu;
    if (body.persistentKeepalive !== undefined) {
      peer.persistentKeepalive = body.persistentKeepalive;
    }
    if (body.expiresAt !== undefined) peer.expiresAt = body.expiresAt;

    try {
      await this._saveAndMarkDirty(peer);
    } catch (err) {
      if (isUniqueViolation(err)) throw WgPeerError.NAME_TAKEN();
      throw err;
    }

    return this._emitUpdated(peer.id);
  }

  async delete(id: string): Promise<void> {
    const peer = await this._findWithRelationsOrFail(id);

    await this._dataSource.transaction(async manager => {
      await this._repo.getRepository(manager).delete({ id: peer.id });
      await this._interfaces.markInterfaceDirty(peer.interfaceId, manager);
    });

    this._eventBus.emit(new WgPeerDeletedEvent(peer.id, peer.userId));
  }

  /** Включение/выключение: право toggle или свой пир с правом own. */
  async setEnabled(
    actor: AuthContext,
    id: string,
    enabled: boolean,
  ): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);

    if (!this._canToggle(actor) && !this._isOwnPeer(actor, peer)) {
      throw WgPeerError.NOT_FOUND();
    }

    if (peer.enabled !== enabled) {
      peer.enabled = enabled;
      peer.disabledReason = enabled ? null : EWgPeerDisabledReason.Manual;
      await this._saveAndMarkDirty(peer);
    }

    return this._emitUpdated(peer.id);
  }

  async rotatePresharedKey(id: string): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);

    peer.presharedKeyEnc = this._secrets.seal(generateWgPresharedKey());
    await this._saveAndMarkDirty(peer);

    return this._emitUpdated(peer.id);
  }

  async removePresharedKey(id: string): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);

    if (!peer.presharedKeyEnc) throw WgPeerError.NO_PSK();

    peer.presharedKeyEnc = null;
    await this._saveAndMarkDirty(peer);

    return this._emitUpdated(peer.id);
  }

  async assign(id: string, body: IAssignWgPeerBody): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);
    const previousUserId = peer.userId;

    peer.userId = body.userId;

    try {
      await this._repo.save(peer);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        throw WgPeerError.USER_NOT_FOUND();
      }
      throw err;
    }

    return this._emitUpdated(peer.id, previousUserId);
  }

  async revoke(id: string): Promise<WgPeerDto> {
    const peer = await this._findWithRelationsOrFail(id);
    const previousUserId = peer.userId;

    peer.userId = null;
    await this._repo.save(peer);

    return this._emitUpdated(peer.id, previousUserId);
  }

  /** Клиентский конфиг (owner или право view). */
  async buildConfig(actor: AuthContext, id: string): Promise<IWgPeerConfig> {
    const peer = await this._findScoped(actor, id);

    if (!peer.privateKeyEnc) throw WgPeerError.NO_PRIVATE_KEY();

    const iface = peer.iface!;
    const endpoint = resolveClientEndpoint(iface);

    if (!endpoint) throw WgPeerError.ENDPOINT_UNRESOLVED();

    const content = buildWgClientConfig({
      privateKey: this._secrets.open(peer.privateKeyEnc),
      addressV4: peer.addressV4,
      addressV6: peer.addressV6,
      dns: peer.clientDns ?? iface.dns,
      mtu: peer.clientMtu ?? iface.mtu,
      serverPublicKey: iface.publicKey,
      presharedKey: peer.presharedKeyEnc
        ? this._secrets.open(peer.presharedKeyEnc)
        : null,
      allowedIPs: peer.clientAllowedIPs,
      endpoint,
      persistentKeepalive: peer.persistentKeepalive,
    });

    return { fileName: wgConfigFileName(peer.name), content };
  }

  async buildQr(actor: AuthContext, id: string): Promise<IWgPeerQrDto> {
    const { content } = await this.buildConfig(actor, id);

    return {
      dataUrl: await QRCode.toDataURL(content, {
        errorCorrectionLevel: "M",
        width: 400,
      }),
    };
  }

  /** Пиры интерфейса для серверного конфига (desired state агента). */
  async serverPeers(
    interfaceIds: string[],
  ): Promise<Map<string, IWgServerPeer[]>> {
    const peers = await this._repo.findEnabledByInterfaces(interfaceIds);
    const result = new Map<string, IWgServerPeer[]>();

    for (const peer of peers) {
      const list = result.get(peer.interfaceId) ?? [];

      list.push({
        publicKey: peer.publicKey,
        presharedKey: peer.presharedKeyEnc
          ? this._secrets.open(peer.presharedKeyEnc)
          : null,
        allowedIps: [
          `${peer.addressV4}/32`,
          ...(peer.addressV6 ? [`${peer.addressV6}/128`] : []),
        ].join(", "),
      });
      result.set(peer.interfaceId, list);
    }

    return result;
  }

  /** Батч-обновление handshake/endpoint/трафика из статистики агента. */
  async applyStatsUpdates(updates: IWgPeerStatsUpdate[]): Promise<void> {
    await this._repo.updateStatsMany(updates);
  }

  /** Отключить просроченные пиры; возвращает число отключённых. */
  async disableExpired(): Promise<number> {
    const expired = await this._repo.findExpired(new Date());

    for (const peer of expired) {
      peer.enabled = false;
      peer.disabledReason = EWgPeerDisabledReason.Expired;
      await this._saveAndMarkDirty(peer);
      await this._emitUpdated(peer.id);
    }

    return expired.length;
  }

  async findEntity(id: string): Promise<WgPeer> {
    return this._findWithRelationsOrFail(id);
  }

  private _canViewAll(actor: AuthContext): boolean {
    return (
      isSuperUser(actor) ||
      hasPermission(actor.permissions, WgPeerPermissions.PEER_VIEW)
    );
  }

  private _canToggle(actor: AuthContext): boolean {
    return (
      isSuperUser(actor) ||
      hasPermission(actor.permissions, WgPeerPermissions.PEER_TOGGLE)
    );
  }

  private _isOwnPeer(actor: AuthContext, peer: WgPeer): boolean {
    return (
      hasPermission(actor.permissions, WgPeerPermissions.PEER_OWN) &&
      peer.userId === actor.userId
    );
  }

  /** Без права view список ограничивается своими пирами (право own). */
  private _scopeFilters(
    actor: AuthContext,
    filters: IWgPeerFilters,
  ): IWgPeerFilters {
    if (this._canViewAll(actor)) return filters;
    if (hasPermission(actor.permissions, WgPeerPermissions.PEER_OWN)) {
      return { ...filters, userId: actor.userId };
    }

    throw WgPeerError.FORBIDDEN();
  }

  private async _findScoped(actor: AuthContext, id: string): Promise<WgPeer> {
    const peer = await this._findWithRelationsOrFail(id);

    // Чужой пир не раскрывается: 404, а не 403.
    if (!this._canViewAll(actor) && !this._isOwnPeer(actor, peer)) {
      throw WgPeerError.NOT_FOUND();
    }

    return peer;
  }

  private async _saveAndMarkDirty(peer: WgPeer): Promise<void> {
    await this._dataSource.transaction(async manager => {
      await this._repo.getRepository(manager).save(peer);
      // Пиры одинаковы на всех репликах интерфейса.
      await this._interfaces.markInterfaceDirty(peer.interfaceId, manager);
    });
  }

  /** `previousUserId` — держатель до изменения: при смене он узнаёт об этом. */
  private async _emitUpdated(
    id: string,
    previousUserId: string | null = null,
  ): Promise<WgPeerDto> {
    const dto = await this._dtoWithRelations(id);
    const changedOwner =
      previousUserId !== null && previousUserId !== dto.userId
        ? previousUserId
        : null;

    this._eventBus.emit(new WgPeerUpdatedEvent(dto, changedOwner));

    return dto;
  }

  private _mapCreateError(err: unknown): string | null {
    if (!isUniqueViolation(err)) return null;

    switch (pgConstraint(err)) {
      case "IDX_WG_PEERS_IFACE_ADDRESS":
        return WgPeerError.codes.ADDRESS_TAKEN;
      case "IDX_WG_PEERS_IFACE_PUBKEY":
        return WgPeerError.codes.PUBLIC_KEY_TAKEN;
      default:
        return WgPeerError.codes.NAME_TAKEN;
    }
  }

  private _errorByCode(code: string): Error {
    if (code === WgPeerError.codes.ADDRESS_TAKEN) {
      return WgPeerError.ADDRESS_TAKEN();
    }
    if (code === WgPeerError.codes.PUBLIC_KEY_TAKEN) {
      return WgPeerError.PUBLIC_KEY_TAKEN();
    }

    return WgPeerError.NAME_TAKEN();
  }

  private async _dtoWithRelations(id: string): Promise<WgPeerDto> {
    return WgPeerDto.fromEntity(await this._findWithRelationsOrFail(id));
  }

  private async _findWithRelationsOrFail(id: string): Promise<WgPeer> {
    const peer = await this._repo.findWithRelations(id);

    if (!peer) throw WgPeerError.NOT_FOUND();

    return peer;
  }
}
