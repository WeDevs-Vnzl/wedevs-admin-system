import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  createCurrencyAction,
  createExpenseCategoryAction,
  createPaymentMethodAction,
  importRatesCsvAction,
  listExchangeRatesAction,
  loadDailyRatesAction,
  updateCurrencyAction,
  updateExpenseCategoryAction,
  updateFiscalSettingsAction,
  updatePaymentMethodAction,
  upsertExchangeRateAction,
} from "./actions";
import { exchangeRateFilterFromParams, listExchangeRates } from "./queries";

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

const fiscal = {
  ivaRates: ["16", "8", "0"],
  ivaDefaultRate: "16",
  igtfRate: "3",
  igtfCurrencies: ["USD"],
  invoiceDefaultDueDays: 15,
};

// Every write of the finance catalogs, with a valid input (Owner and Admin only, `settings` row).
const writes = [
  ["createCurrency", () => createCurrencyAction({ code: "BRL", name: "Real", symbol: "R$" })],
  [
    "updateCurrency",
    () => updateCurrencyAction({ code: "COP", name: "Peso", symbol: "$", active: true }),
  ],
  [
    "upsertExchangeRate",
    () => upsertExchangeRateAction({ date: "2026-10-12", currency: "VES", usdRate: "760" }),
  ],
  [
    "loadDailyRates",
    () =>
      loadDailyRatesAction({
        date: "2026-10-12",
        source: "BCV",
        rates: [{ currency: "VES", usdRate: "760" }],
      }),
  ],
  [
    "importRatesCsv",
    () =>
      importRatesCsvAction({
        rows: [{ date: "2026-10-12", currency: "VES", usdRate: "760", source: "BCV" }],
      }),
  ],
  ["updateFiscalSettings", () => updateFiscalSettingsAction(fiscal)],
  ["createPaymentMethod", () => createPaymentMethodAction({ code: "BIZUM", name: "Bizum" })],
  ["updatePaymentMethod", () => updatePaymentMethodAction({ id: "pmt_otro", name: "Otro medio" })],
  ["createExpenseCategory", () => createExpenseCategoryAction({ name: "Eventos" })],
  [
    "updateExpenseCategory",
    () => updateExpenseCategoryAction({ id: "ecat_dominios", name: "Dominios y DNS" }),
  ],
] as const;

describe("finance catalog actions: permissions (settings row)", () => {
  it.each(writes)("%s refuses Member and Viewer with FORBIDDEN", async (_name, run) => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      asRole(role);
      await expect(run()).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
  });

  it.each(writes)("%s succeeds for Admin and revalidates its settings page", async (_name, run) => {
    asRole("ADMIN");
    await expect(run()).resolves.toMatchObject({ ok: true });
    expect(cache.revalidatePath).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\//));
  });

  it("refuses Member reading the rates table", async () => {
    asRole("MEMBER");
    await expect(listExchangeRatesAction({})).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("finance catalog actions: effects", () => {
  it("quick load writes the rates into the store and the table reads them", async () => {
    asRole("OWNER");
    const result = await loadDailyRatesAction({
      date: "2026-10-12",
      source: "BCV",
      rates: [
        { currency: "VES", usdRate: "760.5" },
        { currency: "EUR", usdRate: "0.86" },
      ],
    });
    expect(result).toEqual({ ok: true, data: { created: 2, updated: 0 } });
    const page = await listExchangeRatesAction({ dateFrom: "2026-10-12", pageSize: 100 });
    expect(page.ok && page.data.items.map((r) => `${r.currency}:${r.usdRate}:${r.source}`)).toEqual(
      expect.arrayContaining(["VES:760.5:BCV", "EUR:0.86:BCV"]),
    );
  });

  it("validates with the shared schemas: USD has no rate, VAT default must be allowed", async () => {
    asRole("OWNER");
    await expect(
      upsertExchangeRateAction({ date: "2026-10-12", currency: "USD", usdRate: "1" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { currency: ["catalogs.validation.rateCurrencyIsUsd"] },
      },
    });
    const before = structuredClone(getMockStore().fiscal);
    await expect(
      updateFiscalSettingsAction({ ...fiscal, ivaDefaultRate: "12" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { ivaDefaultRate: ["settings.validation.defaultIvaRateNotAllowed"] },
      },
    });
    expect(getMockStore().fiscal).toEqual(before);
  });

  it("maps a service conflict to its field", async () => {
    asRole("OWNER");
    await expect(
      createPaymentMethodAction({ code: "ZELLE", name: "Zelle 2" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        fieldErrors: { code: ["catalogs.paymentMethods.errors.codeTaken"] },
      },
    });
  });
});

describe("rates table queries", () => {
  it("reads the filter from the URL, dropping invalid parts", () => {
    expect(
      exchangeRateFilterFromParams({
        page: "2",
        pageSize: "50",
        sort: "usdRate:asc",
        filters: JSON.stringify({ currency: ["VES"], source: ["BCV", "NOPE"] }),
      }),
    ).toMatchObject({ page: 2, pageSize: 50, sort: "usdRate:asc", currency: ["VES"] });
    expect(exchangeRateFilterFromParams({ page: "-1", sort: "bogus", filters: "{" })).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it("lists the rates through the session context, newest first", async () => {
    asRole("OWNER");
    const page = await listExchangeRates({ currency: ["VES"] });
    expect(page.items[0]).toMatchObject({ date: "2026-10-09", currency: "VES" });
  });
});
