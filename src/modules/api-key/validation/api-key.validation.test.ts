import { expect } from "chai";

import { CreateApiKeySchema } from "./create-api-key.validate";

describe("CreateApiKeySchema", () => {
  it("валидные scopes", () => {
    const ok = CreateApiKeySchema.safeParse({
      name: " integration ",
      scopes: [
        "integration:*",
        "integration:sync",
        "*",
        "integration:nodes/sync-v2",
      ],
    });

    expect(ok.success).to.be.true;
    expect(ok.data?.name).to.equal("integration");
  });

  it("мусор в scope, пустой список, прошлая дата — ошибки", () => {
    expect(CreateApiKeySchema.safeParse({ name: "w", scopes: [] }).success).to
      .be.false;
    expect(
      CreateApiKeySchema.safeParse({ name: "w", scopes: ["Worker :x"] })
        .success,
    ).to.be.false;
    expect(
      CreateApiKeySchema.safeParse({
        name: "w",
        scopes: ["integration:*"],
        expiresAt: "2000-01-01T00:00:00Z",
      }).success,
    ).to.be.false;
  });
});
