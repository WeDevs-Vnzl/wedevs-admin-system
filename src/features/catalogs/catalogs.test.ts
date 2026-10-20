import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { lookupRateAction } from "./actions";
import {
  getFiscalSettings,
  getRateFor,
  listCurrencies,
  listDocumentCategories,
  listDocumentTypes,
  listExpenseCategories,
  listPaymentMethods,
  listTags,
  listTechnologies,
} from "./queries";

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

describe("lookupRateAction", () => {
  it("returns the SelectedRate the RateInput consumes (DT-67), not the DTO schema", async () => {
    const result = await lookupRateAction({ date: "2026-10-09", currency: "VES" });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) throw new Error("expected a rate");
    expect(Object.keys(result.data).sort()).toEqual([
      "effectiveDate",
      "isFallback",
      "options",
      "source",
      "usdRate",
    ]);
    expect(result.data).toMatchObject({
      source: "BCV",
      isFallback: false,
      effectiveDate: "2026-10-09",
    });
    expect(result.data.options.map((o) => o.source)).toEqual(["BCV", "OTRA"]);
  });

  it("returns the fallback flag for the missing business day", async () => {
    expect(await lookupRateAction({ date: "2026-10-02", currency: "VES" })).toMatchObject({
      ok: true,
      data: { isFallback: true, effectiveDate: "2026-10-01" },
    });
  });

  it("returns ok with null when there is no rate: the user types it", async () => {
    expect(await lookupRateAction({ date: "2020-01-01", currency: "VES" })).toEqual({
      ok: true,
      data: null,
    });
  });

  it("is reference data: every signed-in role may ask", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await lookupRateAction({ date: "2026-10-09", currency: "EUR" })).toMatchObject({
      ok: true,
    });
  });

  it("requires a session and a valid input", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await lookupRateAction({ date: "2026-10-09", currency: "VES" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(await lookupRateAction({ date: "2026-13-40", currency: "ves" })).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: {
          date: ["validation.date.invalid"],
          currency: ["validation.currency.invalid"],
        },
      },
    });
  });
});

describe("catalog queries", () => {
  it("read through the session context", async () => {
    expect((await listCurrencies()).map((c) => c.code)).toContain("VES");
    expect(await listPaymentMethods()).toHaveLength(10);
    expect(await listPaymentMethods({ includeInactive: true })).toHaveLength(10);
    expect((await getFiscalSettings()).ivaRates).toEqual(["16", "8", "0"]);
    expect(await getRateFor({ date: "2026-10-09", currency: "USD" })).toMatchObject({
      usdRate: "1",
    });
    expect(await listExpenseCategories()).toHaveLength(10);
    expect(await listDocumentCategories()).toHaveLength(5);
  });

  it("parse the filter before calling the service (defaults, URL strings)", async () => {
    const techs = await listTechnologies();
    expect(techs).toMatchObject({ page: 1, pageSize: 25 });
    expect(
      (await listTechnologies({ category: "IA", pageSize: "100" as never })).items.every(
        (t) => t.category === "IA",
      ),
    ).toBe(true);
    expect((await listDocumentTypes({ requiresSignature: "true" as never })).total).toBe(5);
    expect((await listTags({ q: "cliente" })).items.map((t) => t.name)).toEqual(["Cliente clave"]);
  });

  it("hide inactive rows unless the Settings screens ask for them (m-g)", async () => {
    const store = getMockStore();
    store.currencies.find((c) => c.code === "COP")!.active = false;
    store.paymentMethods[0]!.active = false;
    store.expenseCategories.find((c) => c.name === "Otros")!.active = false;

    expect((await listCurrencies()).map((c) => c.code)).not.toContain("COP");
    expect((await listCurrencies({ includeInactive: true })).map((c) => c.code)).toContain("COP");
    expect(await listPaymentMethods()).toHaveLength(9);
    expect(await listPaymentMethods({ includeInactive: "true" as never })).toHaveLength(10);
    expect((await listExpenseCategories()).map((n) => n.name)).not.toContain("Otros");
    expect((await listExpenseCategories({ includeInactive: true })).map((n) => n.name)).toContain(
      "Otros",
    );
  });

  it("serve the moved tag and technology services with usage counts", async () => {
    const tags = await listTags({ sort: "usageCount:desc" });
    expect(tags.items[0]!.usageCount).toBeGreaterThan(0);
    const techs = await listTechnologies({ sort: "usageCount:desc" });
    expect(techs.items[0]!.usageCount).toBeGreaterThan(0);
  });

  it("reject an invalid filter", async () => {
    await expect(listTechnologies({ sort: "bogus" })).rejects.toThrow();
  });

  it("need a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    await expect(listCurrencies()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
