import { expect } from "chai";
import os from "os";

import { buildDocsServers } from "./docs-servers";

const iface = (
  address: string,
  internal = false,
  family: "IPv4" | "IPv6" = "IPv4",
): os.NetworkInterfaceInfo =>
  ({ address, internal, family }) as os.NetworkInterfaceInfo;

describe("buildDocsServers", () => {
  it("lists localhost, LAN IPv4, public URL and remote servers in order", () => {
    const servers = buildDocsServers({
      port: 8181,
      publicUrl: "https://api.example.com/",
      extra: ["http://198.51.100.10:8181"],
      interfaces: {
        lo0: [iface("127.0.0.1", true)],
        en0: [iface("192.168.1.107"), iface("fe80::1", false, "IPv6")],
      },
    });

    expect(servers.map(s => s.url)).to.deep.equal([
      "http://localhost:8181",
      "http://192.168.1.107:8181",
      "https://api.example.com",
      "http://198.51.100.10:8181",
    ]);
  });

  it("puts the origin the docs were opened from first (no CORS in Try it out)", () => {
    const servers = buildDocsServers({
      port: 8181,
      origin: "http://0.0.0.0:8181",
      interfaces: { en0: [iface("192.168.1.107")] },
    });

    expect(servers.map(s => s.url)).to.deep.equal([
      "http://0.0.0.0:8181",
      "http://localhost:8181",
      "http://192.168.1.107:8181",
    ]);
  });

  it("drops duplicates", () => {
    const servers = buildDocsServers({
      port: 8181,
      publicUrl: "http://localhost:8181",
      extra: ["http://localhost:8181/"],
      interfaces: {},
    });

    expect(servers.map(s => s.url)).to.deep.equal(["http://localhost:8181"]);
  });
});
