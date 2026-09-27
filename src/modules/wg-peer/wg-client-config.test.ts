import { expect } from "chai";

import { buildWgClientConfig, wgConfigFileName } from "./wg-client-config";

describe("wg-client-config", () => {
  it("собирает полный конфиг", () => {
    const config = buildWgClientConfig({
      privateKey: "PRIV",
      addressV4: "10.0.0.2",
      addressV6: "fd00:10::2",
      dns: "1.1.1.1, 8.8.8.8",
      mtu: 1420,
      serverPublicKey: "SRV",
      presharedKey: "PSK",
      allowedIPs: "0.0.0.0/0, ::/0",
      endpoint: "vpn.example.com:51820",
      persistentKeepalive: 25,
    });

    expect(config).to.equal(
      [
        "[Interface]",
        "PrivateKey = PRIV",
        "Address = 10.0.0.2/32, fd00:10::2/128",
        "DNS = 1.1.1.1, 8.8.8.8",
        "MTU = 1420",
        "",
        "[Peer]",
        "PublicKey = SRV",
        "PresharedKey = PSK",
        "AllowedIPs = 0.0.0.0/0, ::/0",
        "Endpoint = vpn.example.com:51820",
        "PersistentKeepalive = 25",
        "",
      ].join("\n"),
    );
  });

  it("пропускает необязательные поля", () => {
    const config = buildWgClientConfig({
      privateKey: "PRIV",
      addressV4: "10.0.0.2",
      addressV6: null,
      dns: null,
      mtu: null,
      serverPublicKey: "SRV",
      presharedKey: null,
      allowedIPs: "10.0.0.0/8",
      endpoint: "1.2.3.4:51820",
      persistentKeepalive: 0,
    });

    expect(config).to.not.include("DNS");
    expect(config).to.not.include("MTU");
    expect(config).to.not.include("PresharedKey");
    expect(config).to.include("Address = 10.0.0.2/32\n");
  });

  it("имя файла безопасно и коротко", () => {
    expect(wgConfigFileName("Мой телефон!")).to.equal("wg.conf");
    expect(wgConfigFileName("phone-01")).to.equal("phone-01.conf");
    expect(wgConfigFileName("a".repeat(50))).to.equal(`${"a".repeat(15)}.conf`);
  });
});
