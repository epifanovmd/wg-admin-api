import { expect } from "chai";

import { allocatePeerIpv4, derivePeerIpv6 } from "./wg-ip-allocator";

describe("wg-ip-allocator", () => {
  it("выделяет первый свободный адрес, пропуская адрес интерфейса", () => {
    expect(allocatePeerIpv4("10.0.0.1/24", [])).to.equal("10.0.0.2");
    expect(allocatePeerIpv4("10.0.0.1/24", ["10.0.0.2"])).to.equal("10.0.0.3");
    expect(allocatePeerIpv4("10.0.0.1/24", ["10.0.0.2", "10.0.0.4"])).to.equal(
      "10.0.0.3",
    );
  });

  it("возвращает null при исчерпании подсети", () => {
    expect(allocatePeerIpv4("10.0.0.1/30", ["10.0.0.2"])).to.equal(null);
  });

  it("не выдаёт адрес сети и broadcast", () => {
    const used = ["10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"];

    expect(allocatePeerIpv4("10.0.0.1/29", used)).to.equal("10.0.0.6");
    expect(allocatePeerIpv4("10.0.0.1/29", [...used, "10.0.0.6"])).to.equal(
      null,
    );
  });

  it("производит IPv6 из смещения IPv4", () => {
    expect(derivePeerIpv6("fd00:10::1/64", "10.0.0.1/24", "10.0.0.2")).to.equal(
      "fd00:10::2",
    );
    expect(
      derivePeerIpv6("fd00:10::1/64", "10.0.0.1/24", "10.0.0.255"),
    ).to.equal("fd00:10::ff");
    expect(derivePeerIpv6(null, "10.0.0.1/24", "10.0.0.2")).to.equal(null);
  });
});
