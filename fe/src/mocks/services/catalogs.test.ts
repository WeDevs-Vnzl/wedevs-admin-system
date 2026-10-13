// MOCK — tests for the catalog mock services.
import { describe, expect, it } from "vitest";
import {
  currencyListInputSchema,
  expenseCategoryListInputSchema,
  paymentMethodListInputSchema,
} from "@/lib/validators/catalogs";
import { documentTypeFilterSchema } from "@/lib/validators/document-types";
import { technologyFilterSchema } from "@/lib/validators/technologies";
import { FIXED_TODAY, makeTestContext } from "../test-helpers";
import {
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
