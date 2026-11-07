import { describe, expect, it } from "vitest";
import { knownEntityType } from "./entity-type";

describe("knownEntityType", () => {
  it("returns the entity types the FE has labels and routes for", () => {
    expect(knownEntityType("CLIENT")).toBe("CLIENT");
    expect(knownEntityType("ACCOUNT_MOVEMENT")).toBe("ACCOUNT_MOVEMENT");
    expect(knownEntityType("PAYMENT_LINK")).toBe("PAYMENT_LINK");
    expect(knownEntityType("API_TOKEN")).toBe("API_TOKEN");
  });

  it("returns null for an entity type the FE does not know yet (no route, raw code)", () => {
    expect(knownEntityType("SOME_FUTURE_TYPE")).toBeNull();
    expect(knownEntityType("")).toBeNull();
  });
});
