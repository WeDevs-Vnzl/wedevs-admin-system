// MOCK — tests for the MOCK-only session services.
import { afterEach, describe, expect, it } from "vitest";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import { getMockStore } from "../store";
import { resetMockData, setMockRole } from "./session";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("setMockRole", () => {
  it("accepts the role to view as", async () => {
    const { ctx } = makeTestContext();
    expect(await setMockRole(ctx, { role: "VIEWER" })).toEqual({ role: "VIEWER" });
  });
});

describe("resetMockData", () => {
  it("rebuilds the global store from the fixtures and reports when", async () => {
    const store = getMockStore();
    store.tags.length = 0;
    store.sequences.PAG = 12;

    const { ctx } = makeTestContext();
    expect(await resetMockData(ctx)).toEqual({ resetAt: FIXED_NOW.toISOString() });

    expect(getMockStore()).toBe(store);
    expect(store.tags.length).toBeGreaterThan(0);
    expect(store.sequences.PAG).toBe(0);
  });
});
