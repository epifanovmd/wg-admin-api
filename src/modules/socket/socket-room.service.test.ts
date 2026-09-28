import { expect } from "chai";
import sinon from "sinon";

import { SocketRoomService } from "./socket-room.service";
import type { ISocketRoomPolicy } from "./socket-rooms";

const makePolicy = (
  type: string,
  canJoin: (userId: string, id: string) => Promise<boolean>,
): ISocketRoomPolicy => ({ type, room: id => `${type}_${id}`, canJoin });

const makeSocket = (userId = "u1") => {
  const rooms = new Set<string>();

  return {
    data: { userId, sessionId: "s1", roles: [], permissions: [] } as any,
    rooms,
    join: sinon.stub().callsFake((room: string) => rooms.add(room)),
    leave: sinon.stub().callsFake((room: string) => rooms.delete(room)),
    emit: sinon.stub(),
  };
};

const makeServer = (sockets: ReturnType<typeof makeSocket>[]) => ({
  io: {
    in: sinon.stub().returns({
      fetchSockets: sinon.stub().resolves(sockets),
    }),
  },
});

describe("SocketRoomService", () => {
  it("подписка по политике: вход в комнату и запись подписки", async () => {
    const socket = makeSocket();
    const service = new SocketRoomService(makeServer([]) as any, [
      makePolicy("wg-node", async () => true),
    ]);

    expect(await service.subscribe(socket as any, "wg-node", "n1")).to.be.true;
    expect(socket.rooms.has("wg-node_n1")).to.be.true;
    expect(socket.data.subscriptions).to.deep.equal({
      "wg-node_n1": { type: "wg-node", id: "n1" },
    });
  });

  it("без права, неизвестный тип или сбой политики — отказ без входа", async () => {
    const socket = makeSocket();
    const service = new SocketRoomService(makeServer([]) as any, [
      makePolicy("denied", async () => false),
      makePolicy("broken", async () => {
        throw new Error("db");
      }),
    ]);

    expect(await service.subscribe(socket as any, "denied", "x")).to.be.false;
    expect(await service.subscribe(socket as any, "broken", "x")).to.be.false;
    expect(await service.subscribe(socket as any, "unknown", "x")).to.be.false;
    expect(await service.subscribe(socket as any, "denied", 1 as any)).to.be
      .false;
    expect(socket.join.called).to.be.false;
  });

  it("отписка выходит из комнаты и забывает подписку", async () => {
    const socket = makeSocket();
    const service = new SocketRoomService(makeServer([]) as any, [
      makePolicy("wg-node", async () => true),
    ]);

    await service.subscribe(socket as any, "wg-node", "n1");
    service.unsubscribe(socket as any, "wg-node", "n1");

    expect(socket.rooms.has("wg-node_n1")).to.be.false;
    expect(socket.data.subscriptions).to.deep.equal({});
  });

  it("пересмотр: из комнат без доступа сокеты выходят и получают room:revoked", async () => {
    let allowed = true;
    const a = makeSocket();
    const b = makeSocket();
    const service = new SocketRoomService(makeServer([a, b]) as any, [
      makePolicy("wg-node", async () => allowed),
      makePolicy("wg-peer", async () => true),
    ]);

    for (const socket of [a, b]) {
      await service.subscribe(socket as any, "wg-node", "n1");
      await service.subscribe(socket as any, "wg-peer", "p1");
    }

    allowed = false;
    await service.revalidateUser("u1");

    for (const socket of [a, b]) {
      expect(socket.rooms.has("wg-node_n1")).to.be.false;
      expect(socket.rooms.has("wg-peer_p1")).to.be.true;
      expect(
        socket.emit.calledOnceWith("room:revoked", {
          type: "wg-node",
          id: "n1",
        }),
      ).to.be.true;
    }
  });

  it("пересмотр пропускает комнаты, из которых сокет уже вышел", async () => {
    const socket = makeSocket();
    const canJoin = sinon.stub().resolves(true);
    const service = new SocketRoomService(makeServer([socket]) as any, [
      makePolicy("wg-node", canJoin),
    ]);

    await service.subscribe(socket as any, "wg-node", "n1");
    socket.rooms.delete("wg-node_n1");
    canJoin.resetHistory();
    await service.revalidateUser("u1");

    expect(canJoin.called).to.be.false;
    expect(socket.emit.called).to.be.false;
  });
});
