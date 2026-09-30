import "reflect-metadata";

import { expect } from "chai";

import { Role } from "./role.entity";

describe("Role.toDTO", () => {
  it("роль без загруженных прав (только что создана) — пустой список", () => {
    const role = Object.assign(new Role(), {
      id: "r1",
      name: "moderator",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(role.toDTO().permissions).to.deep.equal([]);
  });
});
