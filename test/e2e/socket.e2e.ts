import { expect } from "chai";

import { Actor, signInAdmin } from "./client";
import { connectSocket } from "./socket";

describe("сокеты", () => {
  let admin: Actor;

  before(async () => {
    admin = await signInAdmin();
  });

  it("подписка на комнату сразу после подключения получает ответ", async () => {
    // Клиент (и переподключение) шлёт room:subscribe сразу по connect —
    // сервер ещё регистрирует соединение в Redis; запрос не должен теряться.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ws = await connectSocket(admin);

      try {
        expect(
          await ws.join("job", "00000000-0000-4000-8000-000000000000"),
        ).to.deep.equal({ ok: false });
      } finally {
        ws.close();
      }
    }
  });

  it("неизвестный тип комнаты — отказ, комната не раскрывается", async () => {
    const ws = await connectSocket(admin);

    try {
      expect(await ws.join("no-such-room", "x")).to.deep.equal({ ok: false });
    } finally {
      ws.close();
    }
  });
});
