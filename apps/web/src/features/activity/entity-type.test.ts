import { describe, expect, it } from "vitest";
import { knownEntityType } from "./entity-type";

describe("knownEntityType", () => {
  it("returns the entity types the FE has labels and routes for", () => {
    expect(knownEntityType("CLIENT")).toBe("CLIENT");
    expect(knownEntityType("ACCOUNT_MOVEMENT")).toBe("ACCOUNT_MOVEMENT");
  });

  it("returns null for an entity type the FE does not know yet (no route, raw code)", () => {
    expect(knownEntityType("PAYMENT_LINK")).toBeNull();
    expect(knownEntityType("API_TOKEN")).toBeNull();
    expect(knownEntityType("")).toBeNull();
  });
});
