import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgLiveStore } from "./wg-live-store.service";
import { WgViewerDemandService } from "./wg-viewer-demand.service";

describe("WgViewerDemandService", () => {
  afterEach(() => sinon.restore());

  const make = (clients: () => number, live = new WgLiveStore()) =>
    new WgViewerDemandService({ localClientsCount: clients } as any, live);

  it("клиенты этого процесса — спрос есть и виден другим репликам", async () => {
    const clock = sinon.useFakeTimers({ now: 1_000_000 });
    const live = new WgLiveStore();
    const withViewers = make(() => 1, live);
    const otherReplica = make(() => 0, live);

    expect(await withViewers.isWatched()).to.equal(true);
    expect(await otherReplica.isWatched()).to.equal(true);

    // Зрители ушли: отметка истекает.
    clock.tick(11_000);
    expect(await otherReplica.isWatched()).to.equal(false);
  });

  it("без клиентов нигде — спроса нет; ответ кэшируется на интервал проверки", async () => {
    const clock = sinon.useFakeTimers({ now: 1_000_000 });
    let clients = 0;
    const demand = make(() => clients);

    expect(await demand.isWatched()).to.equal(false);
    clients = 2;
    expect(await demand.isWatched()).to.equal(false);
    clock.tick(2_000);
    expect(await demand.isWatched()).to.equal(true);
  });
});
