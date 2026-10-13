// MOCK — tests for the catalog mock services.
import { describe, expect, it } from "vitest";
import {
  createCurrencyInputSchema,
  createExpenseCategoryInputSchema,
  createPaymentMethodInputSchema,
  currencyListInputSchema,
  exchangeRateFiltersSchema,
  expenseCategoryListInputSchema,
  importRatesCsvInputSchema,
  paymentMethodListInputSchema,
  quickRateLoadInputSchema,
  updateCurrencyInputSchema,
  updateExpenseCategoryInputSchema,
  updatePaymentMethodInputSchema,
  upsertExchangeRateInputSchema,
} from "@/lib/validators/catalogs";
import { fiscalSettingsSchema } from "@/lib/validators/settings";
import { documentTypeFilterSchema } from "@/lib/validators/document-types";
import { technologyFilterSchema } from "@/lib/validators/technologies";
import { FIXED_TODAY, makeTestContext } from "../test-helpers";
import {
  createCurrency,
  createExpenseCategory,
  createPaymentMethod,
  importRatesCsv,
  listExchangeRates,
  loadDailyRates,
  updateCurrency,
  updateExpenseCategory,
  updateFiscalSettings,
  updatePaymentMethod,
  upsertExchangeRate,
  getFiscalSettings,
  getRateFor,
  listCurrencies,
  listDocumentCategories,
  listDocumentTypes,
  listExpenseCategories,
  listPaymentMethods,
  getTag,
  getTechnology,
  listTags,
  listTechnologies,
} from "./catalogs";
import * as tagsService from "./tags";
import * as technologiesService from "./technologies";

const ALL = { includeInactive: true };
const ACTIVE = currencyListInputSchema.parse({});

describe("getRateFor", () => {
  it("returns the rate of the exact date, BCV first, with every source as an option (DT-67)", async () => {
    const { ctx } = makeTestContext();
    const rate = await getRateFor(ctx, { date: FIXED_TODAY, currency: "VES" });
    expect(rate).not.toBeNull();
    expect(rate).toMatchObject({
      isFallback: false,
      effectiveDate: FIXED_TODAY,
      source: "BCV",
    });
    expect(rate?.usdRate).toMatch(/^755\.16/);
    expect(rate?.options.map((o) => o.source)).toEqual(["BCV", "OTRA"]);
    expect(rate?.options[0]?.usdRate).toBe(rate?.usdRate);
  });

  it("falls back to the latest earlier date on the missing business day", async () => {
    const { ctx } = makeTestContext();
    const rate = await getRateFor(ctx, { date: "2026-10-02", currency: "VES" });
    expect(rate).toMatchObject({ isFallback: true, effectiveDate: "2026-10-01" });
  });

  it("falls back over a weekend", async () => {
    const { ctx } = makeTestContext();
    const rate = await getRateFor(ctx, { date: "2026-10-10", currency: "VES" });
    expect(rate).toMatchObject({ isFallback: true, effectiveDate: FIXED_TODAY });
  });

  it("returns null when there is no rate on or before the date", async () => {
    const { ctx } = makeTestContext();
    expect(await getRateFor(ctx, { date: "2025-01-01", currency: "VES" })).toBeNull();
    expect(await getRateFor(ctx, { date: FIXED_TODAY, currency: "ABC" })).toBeNull();
  });

  it("USD is always exactly 1, with no options", async () => {
    const { ctx } = makeTestContext();
    expect(await getRateFor(ctx, { date: FIXED_TODAY, currency: "USD" })).toEqual({
      usdRate: "1",
      source: null,
      isFallback: false,
      effectiveDate: FIXED_TODAY,
      options: [],
    });
  });

  it("sees a rate added to the store after it was built", async () => {
    const { ctx, db } = makeTestContext();
    db.exchangeRates.push({
      id: "rte_x",
      date: "2026-10-12",
      currency: "VES",
      usdRate: "760.5",
      source: "MANUAL",
      createdAt: "2026-10-12T10:00:00.000Z",
      createdById: null,
    });
    const rate = await getRateFor(ctx, { date: "2026-10-12", currency: "VES" });
    expect(rate).toMatchObject({ usdRate: "760.5", source: "MANUAL", isFallback: false });
  });
});

describe("simple catalogs", () => {
  it("lists currencies, payment methods and fiscal settings as copies", async () => {
    const { ctx, db } = makeTestContext();
    const currencies = await listCurrencies(ctx, ACTIVE);
    expect(currencies.map((c) => c.code)).toEqual(["USD", "VES", "EUR", "USDT", "COP"]);
    currencies[0]!.name = "changed";
    expect(db.currencies[0]!.name).not.toBe("changed");

    expect(await listPaymentMethods(ctx, paymentMethodListInputSchema.parse({}))).toHaveLength(10);

    const fiscal = await getFiscalSettings(ctx);
    expect(fiscal.ivaRates).toEqual(["16", "8", "0"]);
    fiscal.ivaRates.push("12");
    expect(db.fiscal.ivaRates).toEqual(["16", "8", "0"]);
  });
});

describe("listTechnologies", () => {
  it("paginates, sorts by name and counts non-archived projects as usage", async () => {
    const { ctx, db } = makeTestContext();
    const page = await listTechnologies(ctx, technologyFilterSchema.parse({}));
    expect(page.total).toBe(db.technologies.length);
    expect(page.items).toHaveLength(25);
    expect(page.items.every((row) => row.usageCount >= 0)).toBe(true);
    const names = page.items.map((row) => row.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    );
  });

  it("filters by category, active flag and text", async () => {
    const { ctx, db } = makeTestContext();
    const langs = await listTechnologies(
      ctx,
      technologyFilterSchema.parse({ category: "LENGUAJE", pageSize: 100 }),
    );
    expect(langs.items.every((row) => row.category === "LENGUAJE")).toBe(true);
    expect(langs.total).toBeGreaterThan(5);

    db.technologies.find((t) => t.name === "Rust")!.active = false;
    const inactive = await listTechnologies(ctx, technologyFilterSchema.parse({ active: "false" }));
    expect(inactive.items.map((row) => row.name)).toEqual(["Rust"]);

    const found = await listTechnologies(ctx, technologyFilterSchema.parse({ q: "NEXT" }));
    expect(found.items.map((row) => row.name)).toContain("Next.js");
  });
});

describe("document classification", () => {
  it("lists categories in order, each with its types", async () => {
    const { ctx } = makeTestContext();
    const categories = await listDocumentCategories(ctx);
    expect(categories.map((c) => c.name)).toEqual([
      "Legal",
      "Comercial",
      "Técnico",
      "Operativo",
      "Financiero",
    ]);
    expect(categories[0]?.types.map((t) => t.name)).toContain("Acuerdo de confidencialidad (NDA)");
    expect(categories.flatMap((c) => c.types)).toHaveLength(17);
    expect(categories[0]?.types[0]).not.toHaveProperty("category");
  });

  it("lists and filters types", async () => {
    const { ctx, db } = makeTestContext();
    const all = await listDocumentTypes(ctx, documentTypeFilterSchema.parse({ pageSize: 100 }));
    expect(all.total).toBe(17);
    expect(all.items[0]?.category.name).toBeDefined();

    const signable = await listDocumentTypes(
      ctx,
      documentTypeFilterSchema.parse({ requiresSignature: "true", pageSize: 100 }),
    );
    expect(signable.items.every((t) => t.requiresSignature)).toBe(true);
    expect(signable.total).toBe(5);

    const legal = await listDocumentTypes(
      ctx,
      documentTypeFilterSchema.parse({ categoryId: db.documentCategories[0]!.id, pageSize: 100 }),
    );
    expect(legal.items.every((t) => t.category.name === "Legal")).toBe(true);

    const expiring = await listDocumentTypes(
      ctx,
      documentTypeFilterSchema.parse({ hasExpiration: "true", q: "cotizacion" }),
    );
    expect(expiring.items.map((t) => t.name)).toEqual(["Cotización"]);
  });
});

describe("listExpenseCategories", () => {
  it("returns the two-level tree", async () => {
    const { ctx } = makeTestContext();
    const tree = await listExpenseCategories(ctx, expenseCategoryListInputSchema.parse({}));
    expect(tree).toHaveLength(10);
    const infra = tree.find((node) => node.name === "Infraestructura");
    expect(infra?.children.map((c) => c.name)).toContain("Hosting");
    expect(tree.every((node) => node.parentId === null)).toBe(true);
    expect(tree.flatMap((node) => node.children).every((child) => child.parentId !== null)).toBe(
      true,
    );
  });
});

describe("catalog split (H1-B2)", () => {
  it("re-exports the tag and technology services under the same names", () => {
    expect(listTags).toBe(tagsService.listTags);
    expect(getTag).toBe(tagsService.getTag);
    expect(listTechnologies).toBe(technologiesService.listTechnologies);
    expect(getTechnology).toBe(technologiesService.getTechnology);
  });

  it("counts documents of a type from the document rows, skipping archived ones", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => !row.archivedAt)!;
    const typeId = doc.typeId;
    const before = (
      await listDocumentTypes(ctx, documentTypeFilterSchema.parse({ pageSize: 100 }))
    ).items.find((row) => row.id === typeId)!;
    expect(before.documentCount).toBeGreaterThanOrEqual(1);
    doc.archivedAt = "2026-10-01T00:00:00.000Z";
    const after = (
      await listDocumentTypes(ctx, documentTypeFilterSchema.parse({ pageSize: 100 }))
    ).items.find((row) => row.id === typeId)!;
    expect(after.documentCount).toBe(before.documentCount - 1);
    const categories = await listDocumentCategories(ctx);
    const fromTree = categories.flatMap((c) => c.types).find((t) => t.id === typeId)!;
    expect(fromTree.documentCount).toBe(after.documentCount);
  });
});

describe("m-g: simple catalog lists take (ctx, input) and hide inactive rows", () => {
  it("currencies: active by default, every row with includeInactive", async () => {
    const { ctx, db } = makeTestContext();
    db.currencies.find((c) => c.code === "COP")!.active = false;
    const active = await listCurrencies(ctx, currencyListInputSchema.parse({}));
    expect(active.map((c) => c.code)).toEqual(["USD", "VES", "EUR", "USDT"]);
    const all = await listCurrencies(ctx, currencyListInputSchema.parse(ALL));
    expect(all.map((c) => c.code)).toContain("COP");
  });

  it("payment methods: active by default, every row with includeInactive", async () => {
    const { ctx, db } = makeTestContext();
    db.paymentMethods[0]!.active = false;
    const active = await listPaymentMethods(ctx, paymentMethodListInputSchema.parse({}));
    expect(active).toHaveLength(db.paymentMethods.length - 1);
    expect(active.some((m) => m.id === db.paymentMethods[0]!.id)).toBe(false);
    const all = await listPaymentMethods(ctx, paymentMethodListInputSchema.parse(ALL));
    expect(all).toHaveLength(db.paymentMethods.length);
  });

  it("expense categories: an inactive child or root is hidden unless asked", async () => {
    const { ctx, db } = makeTestContext();
    const hosting = db.expenseCategories.find((c) => c.name === "Hosting")!;
    const otros = db.expenseCategories.find((c) => c.name === "Otros")!;
    hosting.active = false;
    otros.active = false;

    const active = await listExpenseCategories(ctx, expenseCategoryListInputSchema.parse({}));
    expect(active.some((n) => n.id === otros.id)).toBe(false);
    expect(
      active.find((n) => n.name === "Infraestructura")!.children.map((c) => c.name),
    ).not.toContain("Hosting");

    const all = await listExpenseCategories(ctx, expenseCategoryListInputSchema.parse(ALL));
    expect(all.some((n) => n.id === otros.id)).toBe(true);
    expect(all.find((n) => n.name === "Infraestructura")!.children.map((c) => c.name)).toContain(
      "Hosting",
    );
  });
});

// ───────────────────────────── Settings writes (H1-B3 T3, S12) ─────────────────────────────

describe("currency writes", () => {
  it("creates a currency and logs a settings change", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createCurrency(
      ctx,
      createCurrencyInputSchema.parse({ code: "BRL", name: "Real brasileño", symbol: "R$" }),
    );
    expect(created).toEqual({
      code: "BRL",
      name: "Real brasileño",
      symbol: "R$",
      decimals: 2,
      active: true,
    });
    expect(db.currencies.at(-1)).toEqual(created);
    expect(db.activity.at(-1)).toMatchObject({
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: "BRL",
    });
  });

  it("refuses a code that already exists with CONFLICT on the code", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.currencies.length;
    await expect(
      createCurrency(ctx, createCurrencyInputSchema.parse({ code: "VES", name: "x", symbol: "x" })),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { code: ["catalogs.currencies.errors.codeTaken"] },
    });
    expect(db.currencies).toHaveLength(before);
  });

  it("updates every field but the code, and deactivates instead of deleting (C19)", async () => {
    const { ctx, db } = makeTestContext();
    const updated = await updateCurrency(
      ctx,
      updateCurrencyInputSchema.parse({
        code: "COP",
        name: "Peso colombiano",
        symbol: "$",
        decimals: 0,
        active: false,
      }),
    );
    expect(updated).toMatchObject({ code: "COP", symbol: "$", decimals: 0, active: false });
    expect(db.currencies.find((c) => c.code === "COP")).toEqual(updated);
    expect(db.activity.at(-1)!.changes).toMatchObject({
      active: [true, false],
      decimals: ["2", "0"],
    });
  });

  it("answers NOT_FOUND for an unknown code and refuses to deactivate USD", async () => {
    const { ctx, db } = makeTestContext();
    await expect(
      updateCurrency(
        ctx,
        updateCurrencyInputSchema.parse({ code: "XYZ", name: "x", symbol: "x", active: true }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateCurrency(
        ctx,
        updateCurrencyInputSchema.parse({ code: "USD", name: "Dólar", symbol: "$", active: false }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { active: ["catalogs.currencies.errors.usdAlwaysActive"] },
    });
    expect(db.currencies.find((c) => c.code === "USD")!.active).toBe(true);
  });
});

describe("exchange rate writes (DT-67)", () => {
  it("lists the rates newest first, filtered by currency and source", async () => {
    const { ctx } = makeTestContext();
    const page = await listExchangeRates(
      ctx,
      exchangeRateFiltersSchema.parse({ currency: "VES", pageSize: 100 }),
    );
    expect(page.items.every((row) => row.currency === "VES")).toBe(true);
    expect(page.items[0]!.date).toBe(FIXED_TODAY);
    const dates = page.items.map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());

    const bcv = await listExchangeRates(
      ctx,
      exchangeRateFiltersSchema.parse({ source: "OTRA", pageSize: 100 }),
    );
    expect(bcv.items.map((row) => `${row.date}:${row.currency}`)).toEqual([`${FIXED_TODAY}:VES`]);
  });

  it("keeps one rate per date, currency and source: a new source adds, the same source updates", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.exchangeRates.length;
    const manual = await upsertExchangeRate(
      ctx,
      upsertExchangeRateInputSchema.parse({
        date: FIXED_TODAY,
        currency: "VES",
        usdRate: "760.10",
        source: "MANUAL",
      }),
    );
    expect(manual).toMatchObject({ created: true, rate: { usdRate: "760.10", source: "MANUAL" } });
    expect(db.exchangeRates).toHaveLength(before + 1);
    expect(manual.rate.createdById).toBe(ctx.user.id);

    const again = await upsertExchangeRate(
      ctx,
      upsertExchangeRateInputSchema.parse({
        date: FIXED_TODAY,
        currency: "VES",
        usdRate: "761",
        source: "MANUAL",
      }),
    );
    expect(again).toMatchObject({ created: false, rate: { id: manual.rate.id, usdRate: "761" } });
    expect(db.exchangeRates).toHaveLength(before + 1);
    // The BCV row of the same day is untouched and still wins the prefill.
    expect(await getRateFor(ctx, { date: FIXED_TODAY, currency: "VES" })).toMatchObject({
      source: "BCV",
    });
  });

  it("refuses a currency that is not in the catalog", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.exchangeRates.length;
    await expect(
      upsertExchangeRate(
        ctx,
        upsertExchangeRateInputSchema.parse({ date: FIXED_TODAY, currency: "ABC", usdRate: "2" }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { currency: ["catalogs.rates.errors.unknownCurrency"] },
    });
    expect(db.exchangeRates).toHaveLength(before);
  });

  it("quick daily load saves several currencies for one date and source", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.exchangeRates.length;
    const result = await loadDailyRates(
      ctx,
      quickRateLoadInputSchema.parse({
        date: "2026-10-12",
        source: "BCV",
        rates: [
          { currency: "VES", usdRate: "757.5" },
          { currency: "EUR", usdRate: "0.861" },
        ],
      }),
    );
    expect(result).toEqual({ created: 2, updated: 0 });
    expect(db.exchangeRates).toHaveLength(before + 2);
    expect(await getRateFor(ctx, { date: "2026-10-12", currency: "VES" })).toMatchObject({
      usdRate: "757.5",
      source: "BCV",
      isFallback: false,
    });

    const replay = await loadDailyRates(
      ctx,
      quickRateLoadInputSchema.parse({
        date: "2026-10-12",
        source: "BCV",
        rates: [{ currency: "VES", usdRate: "758" }],
      }),
    );
    expect(replay).toEqual({ created: 0, updated: 1 });
    expect(db.exchangeRates).toHaveLength(before + 2);
  });

  it("quick daily load refuses the whole batch when a currency is unknown", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.exchangeRates.length;
    await expect(
      loadDailyRates(
        ctx,
        quickRateLoadInputSchema.parse({
          date: "2026-10-12",
          rates: [
            { currency: "VES", usdRate: "757.5" },
            { currency: "ABC", usdRate: "3" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "rates.1.currency": ["catalogs.rates.errors.unknownCurrency"] },
    });
    expect(db.exchangeRates).toHaveLength(before);
  });

  it("CSV import creates, skips existing keys unless overwrite, and reports unknown currencies", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.exchangeRates.length;
    const rows = [
      { date: "2026-10-12", currency: "VES", usdRate: "757.5", source: "BCV" },
      { date: FIXED_TODAY, currency: "VES", usdRate: "1", source: "BCV" },
      { date: "2026-10-12", currency: "ABC", usdRate: "3", source: "MANUAL" },
    ];
    const result = await importRatesCsv(ctx, importRatesCsvInputSchema.parse({ rows }));
    expect(result).toEqual({
      created: 1,
      updated: 0,
      skipped: 1,
      errors: [{ row: 3, messages: ["catalogs.rates.errors.unknownCurrency"] }],
    });
    expect(db.exchangeRates).toHaveLength(before + 1);
    const todayBcv = db.exchangeRates.find(
      (r) => r.date === FIXED_TODAY && r.currency === "VES" && r.source === "BCV",
    )!;
    expect(todayBcv.usdRate).toMatch(/^755\.16/);

    const overwritten = await importRatesCsv(
      ctx,
      importRatesCsvInputSchema.parse({ rows: rows.slice(0, 2), overwrite: true }),
    );
    expect(overwritten).toEqual({ created: 0, updated: 2, skipped: 0, errors: [] });
    expect(todayBcv.usdRate).toBe("1");
  });
});

describe("updateFiscalSettings", () => {
  it("replaces the fiscal parameters, incl. the allowed VAT rates (DT-44)", async () => {
    const { ctx, db } = makeTestContext();
    const next = fiscalSettingsSchema.parse({
      ivaRates: ["16", "8", "0", "12"],
      ivaDefaultRate: "12",
      igtfRate: "3",
      igtfCurrencies: ["USD", "EUR"],
      invoiceDefaultDueDays: 30,
    });
    const saved = await updateFiscalSettings(ctx, next);
    expect(saved).toEqual(next);
    expect(db.fiscal).toEqual(next);
    expect(await getFiscalSettings(ctx)).toMatchObject({ ivaRates: ["16", "8", "0", "12"] });
    expect(db.activity.at(-1)).toMatchObject({ action: "SETTINGS_CHANGE", entityId: "fiscal" });
  });

  it("refuses an IGTF currency that is not in the catalog", async () => {
    const { ctx, db } = makeTestContext();
    const before = structuredClone(db.fiscal);
    await expect(
      updateFiscalSettings(
        ctx,
        fiscalSettingsSchema.parse({ ...before, igtfCurrencies: ["USD", "ABC"] }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { igtfCurrencies: ["catalogs.rates.errors.unknownCurrency"] },
    });
    expect(db.fiscal).toEqual(before);
  });
});

describe("payment method writes", () => {
  const fields = { nameEn: undefined, requiresReference: true, suggestsIgtf: false, active: true };

  it("creates a method with a stable code", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createPaymentMethod(
      ctx,
      createPaymentMethodInputSchema.parse({ ...fields, code: "BINANCE_PAY", name: "Binance Pay" }),
    );
    expect(created).toMatchObject({
      code: "BINANCE_PAY",
      name: "Binance Pay",
      nameEn: null,
      requiresReference: true,
      suggestsIgtf: false,
      active: true,
    });
    expect(created.id).toMatch(/^pmt_/);
    expect(db.paymentMethods.at(-1)).toEqual(created);
    expect(db.activity.at(-1)).toMatchObject({ action: "SETTINGS_CHANGE", entityId: created.id });
  });

  it("refuses a repeated code or name with CONFLICT", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.paymentMethods.length;
    await expect(
      createPaymentMethod(
        ctx,
        createPaymentMethodInputSchema.parse({ ...fields, code: "ZELLE", name: "zelle" }),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: {
        code: ["catalogs.paymentMethods.errors.codeTaken"],
        name: ["catalogs.paymentMethods.errors.nameTaken"],
      },
    });
    expect(db.paymentMethods).toHaveLength(before);
  });

  it("updates the flags and keeps the code (DT-70: suggestsIgtf)", async () => {
    const { ctx, db } = makeTestContext();
    const method = db.paymentMethods.find((m) => m.code === "EFECTIVO_VES")!;
    const updated = await updatePaymentMethod(
      ctx,
      updatePaymentMethodInputSchema.parse({
        ...fields,
        id: method.id,
        name: "Efectivo Bs.",
        suggestsIgtf: true,
        active: false,
      }),
    );
    expect(updated).toMatchObject({
      id: method.id,
      code: "EFECTIVO_VES",
      name: "Efectivo Bs.",
      suggestsIgtf: true,
      active: false,
    });
    expect(db.paymentMethods.find((m) => m.id === method.id)).toEqual(updated);
    await expect(
      updatePaymentMethod(
        ctx,
        updatePaymentMethodInputSchema.parse({ ...fields, id: "pmt_missing", name: "x" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("expense category writes (two levels)", () => {
  const fields = { nameEn: undefined, color: undefined, active: true };

  it("creates a root and a child of a root", async () => {
    const { ctx, db } = makeTestContext();
    const root = await createExpenseCategory(
      ctx,
      createExpenseCategoryInputSchema.parse({ ...fields, name: "Eventos", color: "#123456" }),
    );
    expect(root).toMatchObject({ name: "Eventos", parentId: null, color: "#123456" });
    const child = await createExpenseCategory(
      ctx,
      createExpenseCategoryInputSchema.parse({ ...fields, name: "Anuncios", parentId: root.id }),
    );
    expect(child).toMatchObject({ name: "Anuncios", parentId: root.id, nameEn: null, color: null });
    expect(db.expenseCategories.slice(-2)).toEqual([root, child]);
    const tree = await listExpenseCategories(ctx, expenseCategoryListInputSchema.parse({}));
    expect(tree.find((n) => n.id === root.id)!.children.map((c) => c.name)).toEqual(["Anuncios"]);
  });

  it("refuses a third level, an unknown parent and a repeated sibling name", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.expenseCategories.length;
    const hosting = db.expenseCategories.find((c) => c.name === "Hosting")!;
    await expect(
      createExpenseCategory(
        ctx,
        createExpenseCategoryInputSchema.parse({ ...fields, name: "VPS", parentId: hosting.id }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { parentId: ["catalogs.expenseCategories.errors.parentNotRoot"] },
    });
    await expect(
      createExpenseCategory(
        ctx,
        createExpenseCategoryInputSchema.parse({
          ...fields,
          name: "VPS",
          parentId: "ecat_missing",
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { parentId: ["catalogs.expenseCategories.errors.parentNotRoot"] },
    });
    await expect(
      createExpenseCategory(
        ctx,
        createExpenseCategoryInputSchema.parse({
          ...fields,
          name: "hosting",
          parentId: hosting.parentId,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { name: ["catalogs.expenseCategories.errors.nameTaken"] },
    });
    expect(db.expenseCategories).toHaveLength(before);
  });

  it("updates a category and refuses to nest a root that has children", async () => {
    const { ctx, db } = makeTestContext();
    const infra = db.expenseCategories.find((c) => c.name === "Infraestructura")!;
    const ia = db.expenseCategories.find((c) => c.name === "IA")!;
    await expect(
      updateExpenseCategory(
        ctx,
        updateExpenseCategoryInputSchema.parse({
          ...fields,
          id: infra.id,
          name: infra.name,
          parentId: ia.id,
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { parentId: ["catalogs.expenseCategories.errors.hasChildren"] },
    });
    expect(infra.parentId).toBeNull();

    const updated = await updateExpenseCategory(
      ctx,
      updateExpenseCategoryInputSchema.parse({
        ...fields,
        id: infra.id,
        name: "Infra",
        color: "#000000",
        active: false,
      }),
    );
    expect(updated).toMatchObject({ id: infra.id, name: "Infra", active: false, parentId: null });
    expect(db.expenseCategories.find((c) => c.id === infra.id)).toEqual(updated);
    expect(db.activity.at(-1)!.changes).toMatchObject({ name: ["Infraestructura", "Infra"] });
  });
});
