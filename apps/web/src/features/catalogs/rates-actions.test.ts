import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import type { RateLookupResult } from "@/components/ui/rate-input";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  importRatesCsvAction,
  listExchangeRatesAction,
  loadDailyRatesAction,
  lookupRateAction,
  upsertExchangeRateAction,
} from "./actions";
import {
  exchangeRateFilterFromParams,
  getQuickLoadContext,
  getRateFor,
  listExchangeRates,
} from "./queries";
import { lookupRate } from "./rate-lookup";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.api = mocked.api;
  return mocked;
}

beforeEach(() => {
  server.api = null;
  cache.revalidatePath.mockReset();
});

const rate = {
  id: "r1",
  date: "2026-10-09",
  currency: "VES",
  usdRate: "36.5000",
  source: "BCV",
  createdAt: "2026-10-09T12:00:00.000Z",
  createdById: null,
};
const lookup = {
  usdRate: "36.5000",
  source: "BCV",
  isFallback: false,
  effectiveDate: "2026-10-09",
  options: [
    { source: "BCV", usdRate: "36.5000", createdAt: "2026-10-09T12:00:00.000Z" },
    { source: "OTRA", usdRate: "37.0000", createdAt: "2026-10-09T13:00:00.000Z" },
  ],
};

describe("rates table reads", () => {
  it("lists stored rates through the BE with the filter as query params", async () => {
    const page = { items: [rate], total: 1, page: 1, pageSize: 25, pageCount: 1 };
    const { calls } = useApi({ "GET /api/v1/exchange-rates": { body: page } });
    const filter = {
      currency: ["VES"],
      source: ["BCV"],
      dateFrom: "2026-10-01",
      sort: "date:desc",
    } as const;
    expect(await listExchangeRates({ ...filter, currency: ["VES"], source: ["BCV"] })).toEqual(
      page,
    );
    const search = calls[0]!.search;
    expect(search.getAll("currency")).toEqual(["VES"]);
    expect(search.getAll("source")).toEqual(["BCV"]);
    expect(search.get("dateFrom")).toBe("2026-10-01");
    expect(search.get("sort")).toBe("date:desc");
    expect(search.get("pageSize")).toBe("25");
  });

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

  it("table refresh action: Member gets FORBIDDEN", async () => {
    useApi({ "GET /api/v1/exchange-rates": errorEnvelope("FORBIDDEN") });
    expect(await listExchangeRatesAction({ page: 1, pageSize: 25 } as never)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("rates writes", () => {
  it("upserts a rate, keeping the rate a string, and revalidates the rates page", async () => {
    const { calls } = useApi({
      "POST /api/v1/exchange-rates": { body: { created: true, deviationExceeded: false, rate } },
    });
    const result = await upsertExchangeRateAction({
      date: "2026-10-09",
      currency: "VES",
      usdRate: "36.5000",
      source: "BCV",
    });
    expect(result).toMatchObject({ ok: true });
    expect(calls[0]?.body).toEqual({
      date: "2026-10-09",
      currency: "VES",
      usdRate: "36.5000",
      source: "BCV",
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/rates");
  });

  it("maps a USD rate other than 1 to the BE's VALIDATION", async () => {
    useApi({
      "POST /api/v1/exchange-rates": errorEnvelope("VALIDATION", {
        fieldErrors: { usdRate: ["catalogs.validation.usdRateMustBeOne"] },
      }),
    });
    expect(
      await upsertExchangeRateAction({
        date: "2026-10-09",
        currency: "VES",
        usdRate: "2",
        source: "MANUAL",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { usdRate: ["catalogs.validation.usdRateMustBeOne"] },
      },
    });
  });

  it("maps a duplicate day to CONFLICT", async () => {
    useApi({ "POST /api/v1/exchange-rates": errorEnvelope("CONFLICT") });
    expect(
      await upsertExchangeRateAction({
        date: "2026-10-09",
        currency: "VES",
        usdRate: "36",
        source: "BCV",
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("daily load posts every currency of the day and returns the counts", async () => {
    const { calls } = useApi({
      "POST /api/v1/exchange-rates/daily": { body: { created: 2, updated: 0 } },
    });
    const input = {
      date: "2026-10-12",
      source: "BCV",
      rates: [
        { currency: "VES", usdRate: "760.5" },
        { currency: "EUR", usdRate: "0.86" },
      ],
    } as const;
    expect(await loadDailyRatesAction({ ...input, rates: [...input.rates] })).toEqual({
      ok: true,
      data: { created: 2, updated: 0 },
    });
    expect(calls[0]?.body).toEqual(input);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/rates");
  });

  it("import with one bad row surfaces the field error on that row", async () => {
    useApi({
      "POST /api/v1/exchange-rates/import": errorEnvelope("VALIDATION", {
        fieldErrors: { "rows.1.usdRate": ["validation.rate.invalid"] },
      }),
    });
    const result = await importRatesCsvAction({
      rows: [
        { date: "2026-10-12", currency: "VES", usdRate: "760", source: "BCV" },
        { date: "2026-10-12", currency: "EUR", usdRate: "x", source: "BCV" },
      ],
      overwrite: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { "rows.1.usdRate": ["validation.rate.invalid"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("import returns the BE summary with its rejected rows", async () => {
    const summary = {
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [{ row: 2, messages: ["catalogs.rates.errors.unknownCurrency"] }],
    };
    useApi({ "POST /api/v1/exchange-rates/import": { body: summary } });
    expect(
      await importRatesCsvAction({
        rows: [{ date: "2026-10-12", currency: "VES", usdRate: "760", source: "BCV" }],
        overwrite: true,
      }),
    ).toEqual({ ok: true, data: summary });
  });
});

describe("rate lookup (frozen: lookupRate, lookupRateAction, getRateFor)", () => {
  it("lookupRateAction returns the RateLookupResult the RateInput consumes (a hit)", async () => {
    const { calls } = useApi({ "GET /api/v1/exchange-rates/lookup": { body: { rate: lookup } } });
    const result = await lookupRateAction({ date: "2026-10-09", currency: "VES" });
    expect(result).toEqual({ ok: true, data: lookup });
    expect(calls[0]?.search.get("date")).toBe("2026-10-09");
    expect(calls[0]?.search.get("currency")).toBe("VES");
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<RateLookupResult | null>();
  });

  it("is ok with null when there is no rate: the user types it (a miss)", async () => {
    useApi({ "GET /api/v1/exchange-rates/lookup": { body: { rate: null } } });
    expect(await lookupRateAction({ date: "2020-01-01", currency: "VES" })).toEqual({
      ok: true,
      data: null,
    });
  });

  it("passes the BE error through (invalid input, no session)", async () => {
    useApi({ "GET /api/v1/exchange-rates/lookup": errorEnvelope("VALIDATION") });
    expect(await lookupRateAction({ date: "bad", currency: "ves" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("lookupRate adapts the action: a hit, the fallback flag and a miss", async () => {
    useApi({
      "GET /api/v1/exchange-rates/lookup": (call) => ({
        body: {
          rate:
            call.search.get("date") === "2020-01-01"
              ? null
              : { ...lookup, isFallback: call.search.get("date") === "2026-10-10" },
        },
      }),
    });
    expect(await lookupRate("2026-10-09", "VES")).toEqual(lookup);
    expect(await lookupRate("2026-10-10", "VES")).toMatchObject({ isFallback: true });
    expect(await lookupRate("2020-01-01", "VES")).toBeNull();
  });

  it("lookupRate is null when the BE refuses", async () => {
    useApi({ "GET /api/v1/exchange-rates/lookup": errorEnvelope("UNAUTHENTICATED") });
    expect(await lookupRate("2026-10-09", "VES")).toBeNull();
  });

  it("getRateFor reads the lookup for any signed-in role", async () => {
    useApi({ "GET /api/v1/exchange-rates/lookup": { body: { rate: lookup } } });
    expect(await getRateFor({ date: "2026-10-09", currency: "VES" })).toEqual(lookup);
  });
});

describe("getQuickLoadContext", () => {
  it("lists the active non-USD currencies with their latest rate; a missing rate is null", async () => {
    useApi({
      "GET /api/v1/currencies": {
        body: [
          { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, active: true },
          { code: "VES", name: "Bolívar", symbol: "Bs", decimals: 2, active: true },
          { code: "EUR", name: "Euro", symbol: "€", decimals: 2, active: true },
        ],
      },
      "GET /api/v1/exchange-rates/lookup": (call) => ({
        body: { rate: call.search.get("currency") === "VES" ? lookup : null },
      }),
    });
    const context = await getQuickLoadContext();
    expect(context.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(context.currencies).toEqual([
      { code: "VES", name: "Bolívar", lastRate: { usdRate: "36.5000", date: "2026-10-09" } },
      { code: "EUR", name: "Euro", lastRate: null },
    ]);
  });
});
