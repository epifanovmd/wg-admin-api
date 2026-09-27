import { startServer, stopServer } from "./harness";

/** Корневые хуки mocha: один сервер на весь прогон. */
export const mochaHooks = {
  beforeAll: async function (this: Mocha.Context) {
    this.timeout(120_000);
    await startServer();
  },
  afterAll: async function (this: Mocha.Context) {
    this.timeout(60_000);
    await stopServer();
  },
};
