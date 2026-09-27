import { expect } from "chai";

import { CreateWgNodeSchema } from "./wg-node.validate";
import {
  allowedIpsListSchema,
  dnsListSchema,
  ipv4CidrSchema,
  wgHostSchema,
} from "./wg-shared.validate";

describe("wg-node validation", () => {
  it("создание: валидное тело проходит", () => {
    const result = CreateWgNodeSchema.safeParse({
      name: "  Германия #1  ",
      publicHost: "vpn.example.com",
    });

    expect(result.success).to.be.true;
    if (result.success) expect(result.data.name).to.equal("Германия #1");
  });

  it("хост: домен и IP валидны, мусор — нет", () => {
    expect(wgHostSchema.safeParse("vpn.example.com").success).to.be.true;
    expect(wgHostSchema.safeParse("198.51.100.10").success).to.be.true;
    expect(wgHostSchema.safeParse("2a01:4f8::1").success).to.be.true;
    expect(wgHostSchema.safeParse("host name").success).to.be.false;
    expect(wgHostSchema.safeParse("host;rm -rf /").success).to.be.false;
    expect(wgHostSchema.safeParse("300.1.1.1").success).to.be.false;
  });

  it("CIDR: адрес с маской", () => {
    expect(ipv4CidrSchema.safeParse("10.0.0.1/24").success).to.be.true;
    expect(ipv4CidrSchema.safeParse("10.0.0.1").success).to.be.false;
    expect(ipv4CidrSchema.safeParse("10.0.0.1/33").success).to.be.false;
  });

  it("AllowedIPs: списки CIDR, включая IPv6", () => {
    expect(allowedIpsListSchema.safeParse("0.0.0.0/0, ::/0").success).to.be
      .true;
    expect(allowedIpsListSchema.safeParse("10.0.0.0/8").success).to.be.true;
    expect(allowedIpsListSchema.safeParse("0.0.0.0/0\nPostUp=x").success).to.be
      .false;
  });

  it("DNS: список адресов", () => {
    expect(dnsListSchema.safeParse("1.1.1.1, 8.8.8.8").success).to.be.true;
    expect(dnsListSchema.safeParse("1.1.1.1; echo").success).to.be.false;
  });
});
