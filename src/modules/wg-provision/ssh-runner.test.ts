import { Duplex, PassThrough } from "node:stream";

import { expect } from "chai";

import { SshRunner } from "./ssh-runner";

/**
 * Канал как в ssh2: после записи удалённая сторона закрывает stdout, а
 * `close` приходит только после `end` читаемой стороны — то есть если stdout
 * кто-то читает.
 */
const fakeChannel = (received: Buffer[]) => {
  const channel = new Duplex({
    read: () => undefined,
    write: (chunk: Buffer, _encoding, done) => {
      received.push(chunk);
      done();
    },
    final: done => {
      channel.push(null);
      done();
    },
    emitClose: false,
  }) as Duplex & { stderr: PassThrough };

  channel.stderr = new PassThrough();
  channel.once("end", () => channel.emit("close", 0));

  return channel;
};

describe("SshRunner.upload", () => {
  it("завершается, когда удалённая команда закрыла канал", async () => {
    // `close` канала ssh2 приходит только после чтения stdout.
    const received: Buffer[] = [];
    const runner = new SshRunner();
    const client = (runner as unknown as { _client: { exec: unknown } })
      ._client;

    client.exec = (
      _command: string,
      callback: (err: Error | undefined, stream: Duplex) => void,
    ) => callback(undefined, fakeChannel(received));

    const done = runner.upload("/tmp/x/file.txt", Buffer.from("hello"));
    const timeout = new Promise<string>(resolve =>
      setTimeout(() => resolve("timeout"), 500),
    );

    expect(await Promise.race([done.then(() => "ok"), timeout])).to.equal("ok");
    expect(Buffer.concat(received).toString()).to.equal("hello");
  });
});

describe("SshRunner.exec", () => {
  it("строки вывода — колбэку по мере поступления, хвост без перевода строки — в конце", async () => {
    const runner = new SshRunner();
    const client = (runner as unknown as { _client: { exec: unknown } })
      ._client;
    const channel = new PassThrough() as PassThrough & { stderr: PassThrough };

    channel.stderr = new PassThrough();
    client.exec = (
      _command: string,
      callback: (err: Error | undefined, stream: PassThrough) => void,
    ) => callback(undefined, channel);

    const lines: string[] = [];
    const done = runner.exec("cmd", 1000, line => lines.push(line));

    channel.write("▶ шаг 1\n▶ ша");
    await new Promise(resolve => setImmediate(resolve));
    expect(lines).to.deep.equal(["▶ шаг 1"]);

    // Кириллица, разрезанная между пакетами посреди символа.
    const tail = Buffer.from("г 2\nхвост");

    channel.write(tail.subarray(0, 1));
    channel.write(tail.subarray(1));
    channel.emit("close", 0);

    const result = await done;

    expect(lines).to.deep.equal(["▶ шаг 1", "▶ шаг 2", "хвост"]);
    expect(result.stdout).to.equal("▶ шаг 1\n▶ шаг 2\nхвост");
  });
});
