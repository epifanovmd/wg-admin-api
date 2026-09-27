import { expect } from "chai";

import { cidrContains, intToIpv4, ipv4ToInt, parseIpv4Cidr } from "./ip-utils";

describe("ip-utils", () => {
  it("конвертирует адрес туда и обратно", () => {
    expect(intToIpv4(ipv4ToInt("10.0.0.1"))).to.equal("10.0.0.1");
    expect(intToIpv4(ipv4ToInt("255.255.255.255"))).to.equal("255.255.255.255");
    expect(ipv4ToInt("0.0.0.1")).to.equal(1);
  });

  it("разбирает CIDR", () => {
    const cidr = parseIpv4Cidr("10.0.0.1/24");

    expect(intToIpv4(cidr.network)).to.equal("10.0.0.0");
    expect(intToIpv4(cidr.broadcast)).to.equal("10.0.0.255");
    expect(cidr.prefix).to.equal(24);
  });

  it("проверяет принадлежность подсети", () => {
    const cidr = parseIpv4Cidr("10.0.0.1/24");

    expect(cidrContains(cidr, ipv4ToInt("10.0.0.42"))).to.be.true;
    expect(cidrContains(cidr, ipv4ToInt("10.0.1.1"))).to.be.false;
  });

  it("отклоняет мусор", () => {
    expect(() => ipv4ToInt("1.2.3")).to.throw();
    expect(() => parseIpv4Cidr("10.0.0.1")).to.throw();
    expect(() => parseIpv4Cidr("10.0.0.1/33")).to.throw();
  });
});
