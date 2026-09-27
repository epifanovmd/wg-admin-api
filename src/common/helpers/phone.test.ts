import { expect } from "chai";

import { normalizePhone, PHONE_RE } from "./phone";

describe("normalizePhone", () => {
  it("приводит 8… и 7… к +7…", () => {
    expect(normalizePhone("89161234567")).to.equal("+79161234567");
    expect(normalizePhone("79161234567")).to.equal("+79161234567");
    expect(normalizePhone("+79161234567")).to.equal("+79161234567");
  });

  it("убирает пробелы, скобки и дефисы", () => {
    expect(normalizePhone("+7 (916) 123-45-67")).to.equal("+79161234567");
  });

  it("невалидное значение возвращает как есть для валидации", () => {
    expect(normalizePhone("12345")).to.equal("12345");
    expect(PHONE_RE.test("12345")).to.be.false;
  });
});
