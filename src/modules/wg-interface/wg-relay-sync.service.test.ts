import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import { WgRelaySyncService } from "./wg-relay-sync.service";

describe("WgRelaySyncService", () => {
  it("линки не изменились — версия релея всё равно поднимается (новый порт проброса)", async () => {
    // Пробросы релея зависят не только от набора линков: второй интерфейс
    // за той же точкой, смена его порта или удаление меняют конфигурацию.
    const relayNodeId = uuid();
    const targetNodeId = uuid2();
    const nodes = { markDirty: sinon.stub().resolves() };
    const service = new WgRelaySyncService(
      {
        targetNodeIdsForRelay: sinon.stub().resolves([targetNodeId]),
      } as any,
      {
        linksForRelay: sinon
          .stub()
          .resolves([{ relayNodeId, targetNodeId, tunnelIndex: 0 }]),
      } as any,
      nodes as any,
    );

    await service.syncRelay(relayNodeId);

    expect(nodes.markDirty.calledWith(relayNodeId)).to.be.true;
  });
});
