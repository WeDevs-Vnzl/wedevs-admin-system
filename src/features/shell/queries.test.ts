import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getShellData } from "./queries";

function clock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { name: "Andrés Molina" }));
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("getShellData", () => {
  it("returns the user, the latest VES rate with its date, and no alerts yet", async () => {
    clock("2026-10-09T15:00:00.000Z"); // Friday, a business day with a rate
    const data = await getShellData();
    expect(data.user.name).toBe("Andrés Molina");
    expect(data.vesRate).toMatchObject({ date: "2026-10-09", source: "BCV" });
    expect(data.vesRate?.usdRate).toMatch(/^755\.16/);
    expect(data.vesRateMissing).toBe(false);
    expect(data.alertCount).toBe(0);
  });

  it("flags a business day that has no rate yet and shows the previous one", async () => {
    clock("2026-10-09T15:00:00.000Z");
    getMockStore(); // the fixtures end on Friday
    clock("2026-10-12T15:00:00.000Z"); // Monday: today's rate has not been loaded yet
    const data = await getShellData();
    expect(data.vesRate?.date).toBe("2026-10-09");
    expect(data.vesRateMissing).toBe(true);
  });

  it("does not flag a weekend: no rate is expected", async () => {
    clock("2026-10-10T15:00:00.000Z"); // Saturday
    const data = await getShellData();
    expect(data.vesRate?.date).toBe("2026-10-09");
    expect(data.vesRateMissing).toBe(false);
  });

  it("flags the missing business day itself and falls back to the day before", async () => {
    clock("2026-10-09T15:00:00.000Z");
    getMockStore(); // build at this clock
    clock("2026-10-02T15:00:00.000Z"); // Friday with no rate in the fixtures
    const data = await getShellData();
    expect(data.vesRate?.date).toBe("2026-10-01");
    expect(data.vesRateMissing).toBe(true);
  });

  it("reports no rate at all as missing", async () => {
    clock("2026-10-09T15:00:00.000Z");
    getMockStore().exchangeRates.length = 0;
    const data = await getShellData();
    expect(data.vesRate).toBeNull();
    expect(data.vesRateMissing).toBe(true);
  });

  it("throws when nobody is signed in (the layout redirects to sign-in)", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    await expect(getShellData()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
