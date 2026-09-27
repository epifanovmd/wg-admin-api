import { expect } from "chai";

import {
  decodeCursor,
  encodeCursor,
  normalizePagination,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  toPage,
} from "./pagination";

describe("pagination", () => {
  it("умолчания и границы", () => {
    expect(normalizePagination()).to.deep.equal({
      offset: 0,
      limit: PAGINATION_DEFAULT_LIMIT,
    });
    expect(normalizePagination(-5, 10_000)).to.deep.equal({
      offset: 0,
      limit: PAGINATION_MAX_LIMIT,
    });
    expect(normalizePagination(40, 10)).to.deep.equal({
      offset: 40,
      limit: 10,
    });
  });

  it("toPage собирает страницу", () => {
    expect(toPage([1, 2], 7, { offset: 0, limit: 2 })).to.deep.equal({
      items: [1, 2],
      total: 7,
      offset: 0,
      limit: 2,
    });
  });

  it("курсор кодируется обратимо, мусор даёт undefined", () => {
    const cursor = encodeCursor({ id: "a", at: 1 });

    expect(decodeCursor(cursor)).to.deep.equal({ id: "a", at: 1 });
    expect(decodeCursor("%%%")).to.equal(undefined);
  });
});
