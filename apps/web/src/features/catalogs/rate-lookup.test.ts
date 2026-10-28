import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { makeSessionUser } from "@/mocks/test-helpers";
import { lookupRate } from "./rate-lookup";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("lookupRate (RateInput adapter over lookupRateAction)", () => {
  it("returns the RateLookupResult of the effective date", async () => {
    const result = await lookupRate("2026-10-09", "VES");
    expect(result).toMatchObject({ source: "BCV", isFallback: false, effectiveDate: "2026-10-09" });
    expect(result?.options.map((o) => o.source)).toEqual(["BCV", "OTRA"]);
  });

  it("flags the fallback for a day without a rate", async () => {
    expect(await lookupRate("2026-10-02", "VES")).toMatchObject({
      isFallback: true,
      effectiveDate: "2026-10-01",
    });
  });

  it("is null when there is no rate, so the user types it", async () => {
    expect(await lookupRate("2020-01-01", "VES")).toBeNull();
  });

  it("is null for input the action refuses, and when nobody is signed in", async () => {
    expect(await lookupRate("not-a-date", "VES")).toBeNull();
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await lookupRate("2026-10-09", "VES")).toBeNull();
  });
});
