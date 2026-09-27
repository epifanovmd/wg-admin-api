import { inject } from "inversify";

import { Injectable } from "../../core";
import { WgSecretBox } from "../wg-node";
import { WgSocksError } from "./wg-socks.errors";
import { WgSocksServiceRepository } from "./wg-socks.repository";
import { buildMacClient } from "./wg-socks-mac-client";
import { certMatchesHost } from "./wg-socks-pki";

/** Клиентские материалы прокси: готовый клиент для устройства. */
@Injectable()
export class WgSocksClientKitService {
  constructor(
    @inject(WgSocksServiceRepository)
    private readonly _services: WgSocksServiceRepository,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
  ) {}

  /**
   * Клиент для macOS (zip): сертификаты клиента, логин и пароль
   * пользователя; без `userId` — первый включённый пользователь. Адрес —
   * `clientHost:clientPort`, иначе publicHost ноды и порт прокси; имя
   * сервера проверяется, если оно есть в серверном сертификате.
   */
  async macClient(
    serviceId: string,
    clientId: string,
    userId?: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const service = await this._services.findWithRelations(serviceId);

    if (!service) throw WgSocksError.NOT_FOUND();

    const client = service.clients?.find(item => item.id === clientId);

    if (!client || client.revoked) throw WgSocksError.CLIENT_NOT_FOUND();

    const host = service.clientHost ?? service.node?.publicHost;

    if (!host) throw WgSocksError.NO_CLIENT_HOST();

    const user = userId
      ? service.users?.find(item => item.id === userId)
      : service.users?.find(item => item.enabled);

    if (!user) throw WgSocksError.USER_NOT_FOUND();

    return buildMacClient({
      serviceName: service.name,
      host,
      port: service.clientPort ?? service.listenPort,
      checkHost: certMatchesHost(service.serverCertPem, service.serverName)
        ? service.serverName
        : null,
      caCertPem: service.caCertPem,
      certPem: client.certPem,
      keyPem: this._secrets.open(client.keyEnc),
      username: user.username,
      password: this._secrets.open(user.passwordEnc),
    });
  }
}
