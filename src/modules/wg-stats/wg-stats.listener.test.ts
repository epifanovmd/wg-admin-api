import "reflect-metadata";

import { expect } from "chai";

import { wgInterfaceRoom } from "../wg-interface";
import { WG_OVERVIEW_ROOM } from "../wg-node";
import { wgOwnPeersRoom, wgPeerRoom } from "../wg-peer";
import { WgPeersLiveStatsEvent } from "./events";
import { WgStatsListener } from "./wg-stats.listener";
import type { IWgPeerLive } from "./wg-stats.types";

interface ISent {
  to: string;
  except?: string | string[];
  event: string;
  peers: string[];
}

const live = (peerId: string, interfaceId: string, userId: string | null) =>
  ({ peerId, interfaceId, userId }) as IWgPeerLive;

describe("WgStatsListener", () => {
  it("статистика пиров за тик — одно событие-пачка на комнату, обзор исключён из остальных рассылок; в личную комнату пользователя не шлётся", () => {
    const handlers = new Map<unknown, (event: any) => void>();
    const sent: ISent[] = [];
    const record =
      (prefix: string) =>
      (target: string, ...rest: any[]) => {
        const [except, event, payload] =
          rest.length === 3 ? rest : [undefined, ...rest];

        sent.push({
          to: prefix + target,
          except,
          event,
          peers: payload.peers.map((p: IWgPeerLive) => p.peerId),
        });
      };
    const listener = new WgStatsListener(
      { on: (type: unknown, fn: any) => handlers.set(type, fn) } as any,
      {
        toRoom: record(""),
        toRoomExcept: record(""),
      } as any,
      {} as any,
    );

    listener.register();
    handlers.get(WgPeersLiveStatsEvent)!(
      new WgPeersLiveStatsEvent("node", [
        live("p1", "i1", "u1"),
        live("p2", "i1", "u1"),
        live("p3", "i2", null),
      ]),
    );

    expect(sent.every(item => item.event === "wg:peers:stats")).to.equal(true);
    expect(sent).to.deep.include({
      to: WG_OVERVIEW_ROOM,
      except: undefined,
      event: "wg:peers:stats",
      peers: ["p1", "p2", "p3"],
    });
    expect(sent.filter(item => item.to !== WG_OVERVIEW_ROOM)).to.deep.equal([
      ...[
        { to: wgInterfaceRoom("i1"), peers: ["p1", "p2"] },
        { to: wgInterfaceRoom("i2"), peers: ["p3"] },
        { to: wgOwnPeersRoom("u1"), peers: ["p1", "p2"] },
        { to: wgPeerRoom("p1"), peers: ["p1"] },
        { to: wgPeerRoom("p2"), peers: ["p2"] },
        { to: wgPeerRoom("p3"), peers: ["p3"] },
      ].map(item => ({
        ...item,
        // Держатель со списком своих пиров не получает пира ещё раз из его комнаты.
        except: [wgPeerRoom("p1"), wgPeerRoom("p2")].includes(item.to)
          ? [WG_OVERVIEW_ROOM, wgOwnPeersRoom("u1")]
          : WG_OVERVIEW_ROOM,
        event: "wg:peers:stats",
      })),
    ]);
  });
});
