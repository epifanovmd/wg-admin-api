import { expect } from "chai";
import { QueryFailedError } from "typeorm";

import { isUniqueViolation, pgConstraint, pgErrorCode } from "./pg-errors";

const queryError = (driverError: Record<string, unknown>) =>
  new QueryFailedError(
    "INSERT",
    [],
    Object.assign(new Error("pg"), driverError),
  );

describe("pg-errors", () => {
  it("код и ограничение из ошибки запроса", () => {
    const err = queryError({ code: "23505", constraint: "IDX_A" });

    expect(pgErrorCode(err)).to.equal("23505");
    expect(isUniqueViolation(err)).to.equal(true);
    expect(pgConstraint(err)).to.equal("IDX_A");
  });

  it("не ошибка запроса — undefined", () => {
    const err = Object.assign(new Error("x"), {
      driverError: { code: "23505", constraint: "IDX_A" },
    });

    expect(pgErrorCode(err)).to.equal(undefined);
    expect(pgConstraint(err)).to.equal(undefined);
  });
});
