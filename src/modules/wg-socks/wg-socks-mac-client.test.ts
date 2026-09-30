import { crc32, inflateRawSync } from "node:zlib";

import { expect } from "chai";

import { WgSocksClientKitService } from "./wg-socks-client-kit.service";
import { buildMacClient, macClientSlug } from "./wg-socks-mac-client";
import { issueCertificate, newCertificateAuthority } from "./wg-socks-pki";
import { buildZip } from "./zip";

/** Файлы архива по центральному каталогу: путь → содержимое и права. */
const readZip = (
  zip: Buffer,
): Map<string, { content: string; mode: number }> => {
  const files = new Map<string, { content: string; mode: number }>();
  const end = zip.length - 22;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);

  for (let index = 0; index < count; index += 1) {
    const packedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    // eslint-disable-next-line no-bitwise -- права unix в старших 16 битах
    const mode = (zip.readUInt32LE(at + 38) >>> 16) & 0o777;
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26);
    const data = inflateRawSync(zip.subarray(dataAt, dataAt + packedSize));

    expect(crc32(data)).to.equal(zip.readUInt32LE(at + 16));
    files.set(name, { content: data.toString("utf8"), mode });
    at += 46 + nameLength;
  }

  return files;
};

const input = {
  serviceName: "Telegram NL",
  host: "198.51.100.10",
  port: 8443,
  checkHost: "proxy.example",
  caCertPem: "CA",
  certPem: "CERT",
  keyPem: "KEY",
  username: "tg@user",
  password: "p'a:s s&x",
};

describe("wg-socks mac client", () => {
  it("zip хранит содержимое и unix-права", () => {
    const files = readZip(
      buildZip([
        { path: "a/run.sh", content: "echo 1\n", mode: 0o755 },
        { path: "a/файл.txt", content: "привет" },
      ]),
    );

    expect(files.get("a/run.sh")).to.deep.equal({
      content: "echo 1\n",
      mode: 0o755,
    });
    expect(files.get("a/файл.txt")).to.deep.equal({
      content: "привет",
      mode: 0o644,
    });
  });

  it("архив: скрипты исполняемые, ключ закрыт, адрес и проверка имени в конфиге", () => {
    const { fileName, content } = buildMacClient(input);
    const files = readZip(content);
    const install = files.get("telegram-nl-mac/install.sh")!;

    expect(fileName).to.equal("telegram-nl-mac.zip");
    expect(install.mode).to.equal(0o755);
    expect(files.get("telegram-nl-mac/uninstall.sh")!.mode).to.equal(0o755);
    expect(files.get("telegram-nl-mac/client-key.pem")).to.deep.equal({
      content: "KEY",
      mode: 0o600,
    });
    expect(install.content).to.include("connect = 198.51.100.10:8443");
    expect(install.content).to.include("checkHost = proxy.example");
    expect(install.content).to.include(`SOCKS_PASS='p'\\''a:s s&x'`);
    expect(files.get("telegram-nl-mac/README.txt")!.content).to.include(
      "tg://socks?server=127.0.0.1&port=1080&user=tg%40user&pass=p'a%3As%20s%26x",
    );
  });

  it("без имени в сертификате проверка имени не включается", () => {
    const files = readZip(
      buildMacClient({ ...input, checkHost: null }).content,
    );

    expect(files.get("telegram-nl-mac/install.sh")!.content).not.to.include(
      "checkHost",
    );
  });

  it("slug из названия: только латиница и цифры, запасное имя", () => {
    expect(macClientSlug("Прокси для TG #1")).to.equal("tg-1");
    expect(macClientSlug("Прокси")).to.equal("proxy");
  });
});

describe("WgSocksClientKitService", () => {
  const secrets = { open: (value: string) => value.replace("enc:", "") };

  const makeService = async (overrides: Record<string, unknown> = {}) => {
    const ca = await newCertificateAuthority("tg-ca");
    const server = await issueCertificate(ca, "203.0.113.70", "server");

    return {
      id: "s1",
      name: "tg",
      listenPort: 8444,
      clientHost: null,
      clientPort: null,
      serverName: "203.0.113.70",
      serverCertPem: server.certPem,
      caCertPem: ca.certPem,
      node: { publicHost: "203.0.113.70" },
      users: [
        { id: "u1", username: "off", enabled: false, passwordEnc: "enc:x" },
        { id: "u2", username: "tg", enabled: true, passwordEnc: "enc:pw" },
      ],
      clients: [
        { id: "c1", certPem: "CERT", keyEnc: "enc:KEY", revoked: false },
        { id: "c2", certPem: "OLD", keyEnc: "enc:OLD", revoked: true },
      ],
      ...overrides,
    };
  };

  const admin = { userId: "a1", roles: ["admin"], permissions: ["*"] } as any;
  const kit = (service: unknown) => {
    const instance = new WgSocksClientKitService(
      { findWithRelations: async () => service } as any,
      secrets as any,
    );

    return {
      macClient: (serviceId: string, clientId: string, userId?: string) =>
        instance.macClient(admin, serviceId, clientId, userId),
    };
  };

  it("адрес ноды и проверка IP из серверного сертификата; первый включённый пользователь", async () => {
    const { content } = await kit(await makeService()).macClient("s1", "c1");
    const install = readZip(content).get("tg-mac/install.sh")!.content;

    expect(install).to.include("connect = 203.0.113.70:8444");
    expect(install).to.include("checkIP = 203.0.113.70");
    expect(install).to.include("SOCKS_USER='tg'");
    expect(readZip(content).get("tg-mac/client-key.pem")!.content).to.equal(
      "KEY",
    );
  });

  it("адрес для клиентов через проброс — в конфиге", async () => {
    const service = await makeService({
      clientHost: "198.51.100.9",
      clientPort: 8443,
    });
    const { content } = await kit(service).macClient("s1", "c1", "u2");

    expect(readZip(content).get("tg-mac/install.sh")!.content).to.include(
      "connect = 198.51.100.9:8443",
    );
  });

  it("отозванный клиент — 404, без адреса — 409", async () => {
    const service = await makeService();

    await kit(service)
      .macClient("s1", "c2")
      .then(
        () => expect.fail("отозванный клиент выдан"),
        err => expect(err.code).to.equal("WG_SOCKS_CLIENT_NOT_FOUND"),
      );
    await kit({ ...service, node: { publicHost: null } })
      .macClient("s1", "c1")
      .then(
        () => expect.fail("без адреса выдан"),
        err => expect(err.code).to.equal("WG_SOCKS_NO_CLIENT_HOST"),
      );
  });

  it("чужой прокси с областью own — 404, свой без права клиентов — 403", async () => {
    const service = await makeService({ ownerId: "u9", createdById: null });
    const instance = new WgSocksClientKitService(
      { findWithRelations: async () => service } as any,
      secrets as any,
    );
    const own = (permissions: string[]) =>
      ({ userId: "u1", roles: [], permissions }) as any;

    await instance
      .macClient(own(["wg:socks:view:own", "wg:socks:clients:own"]), "s1", "c1")
      .then(
        () => expect.fail("чужой прокси выдан"),
        err => expect(err.code).to.equal("WG_SOCKS_NOT_FOUND"),
      );
    await new WgSocksClientKitService(
      {
        findWithRelations: async () => ({ ...service, ownerId: "u1" }),
      } as any,
      secrets as any,
    )
      .macClient(own(["wg:socks:view:own"]), "s1", "c1")
      .then(
        () => expect.fail("выдан без права клиентов"),
        err => expect(err.code).to.equal("WG_SOCKS_FORBIDDEN"),
      );
  });
});
