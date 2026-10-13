import { expect } from "chai";

import { schemaProblems } from "./agent-schemas";

describe("schemaProblems", () => {
  const schema = {
    type: "object",
    properties: { text: { type: "string" }, n: { type: "integer" } },
    required: ["text"],
    additionalProperties: false,
  };

  it("подходит — без замечаний; нет схемы — без проверки", () => {
    expect(schemaProblems(schema, { text: "a", n: 1 })).to.deep.equal([]);
    expect(schemaProblems(undefined, { anything: true })).to.deep.equal([]);
    expect(schemaProblems(null, 5)).to.deep.equal([]);
  });

  it("не подходит — все замечания с путём", () => {
    const problems = schemaProblems(schema, { n: "x", extra: 1 });

    expect(problems.join("\n")).to.include("text");
    expect(problems.join("\n")).to.include("/n");
    expect(problems.length).to.be.at.least(3);
  });

  it("схема, которую нельзя собрать, не мешает работе", () => {
    expect(schemaProblems({ type: "nope" }, 1)).to.deep.equal([]);
  });
});
