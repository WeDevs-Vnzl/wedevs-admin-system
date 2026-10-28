// MOCK — every catalog fixture must parse with the Zod schema of its contract (C8).
import { describe, expect, it } from "vitest";
import { addDays, isBusinessDay } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { selectRate } from "@/lib/rates";
import {
  currencyDtoSchema,
  exchangeRateDtoSchema,
  expenseCategoryDtoSchema,
  paymentMethodDtoSchema,
} from "@/lib/validators/catalogs";
import { documentCategoryRefSchema, documentTypeRefSchema } from "@/lib/validators/document-types";
import { userRoleSchema } from "@/lib/validators/enums";
import { companySettingsSchema, fiscalSettingsSchema } from "@/lib/validators/settings";
import { tagListRowSchema } from "@/lib/validators/tags";
import { technologyListRowSchema } from "@/lib/validators/technologies";
import { userDetailSchema } from "@/lib/validators/users";
import { MOCK_USERS } from "../session";
import {
  DOCUMENT_CATEGORY_FIXTURES,
  DOCUMENT_TYPE_FIXTURES,
  EXPENSE_CATEGORY_FIXTURES,
  LATEST_VES_RATE,
  MISSING_RATE_BUSINESS_DAY_OFFSET,
  RATE_HISTORY_DAYS,
  TECHNOLOGY_FIXTURES,
  createCatalogFixtures,
  slugifyTechnology,
} from "./catalogs";

const TODAY = "2026-10-09"; // a Friday

const fixtures = createCatalogFixtures(TODAY);

function expectAllParse(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  rows: unknown[],
) {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (!result.success) throw new Error(`Fixture does not parse: ${JSON.stringify(row)}`);
  }
}

// Store rows are the list-row DTOs without the usage count, which services derive from the records.
const technologyRowSchema = technologyListRowSchema.omit({ usageCount: true });
const tagRowSchema = tagListRowSchema.omit({ usageCount: true });

function expectUniqueIds(rows: { id: string }[]) {
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
}

describe("catalog fixtures parse with their contract schemas", () => {
  it("currencies: USD, VES, EUR, USDT, COP", () => {
    expectAllParse(currencyDtoSchema, fixtures.currencies);
    expect(fixtures.currencies.map((c) => c.code)).toEqual(["USD", "VES", "EUR", "USDT", "COP"]);
  });

  it("exchange rates", () => {
    expectAllParse(exchangeRateDtoSchema, fixtures.exchangeRates);
    expectUniqueIds(fixtures.exchangeRates);
  });

  it("payment methods (PRD §10.4)", () => {
    expectAllParse(paymentMethodDtoSchema, fixtures.paymentMethods);
    expect(fixtures.paymentMethods).toHaveLength(10);
    expectUniqueIds(fixtures.paymentMethods);
    expect(new Set(fixtures.paymentMethods.map((m) => m.code)).size).toBe(10);
  });

  it("document categories and types (PRD §8.9.1)", () => {
    expectAllParse(documentCategoryRefSchema, fixtures.documentCategories);
    expect(fixtures.documentCategories.map((c) => c.name)).toEqual([
      "Legal",
      "Comercial",
      "Técnico",
      "Operativo",
      "Financiero",
    ]);
    expectAllParse(documentTypeRefSchema, fixtures.documentTypes);
    expect(DOCUMENT_TYPE_FIXTURES).toHaveLength(17);
    expectUniqueIds(fixtures.documentTypes);
    const categoryIds = new Set(DOCUMENT_CATEGORY_FIXTURES.map((c) => c.id));
    expect(fixtures.documentTypes.every((type) => categoryIds.has(type.categoryId))).toBe(true);
  });

  it("expense categories (PRD §8.8): ten roots, two levels", () => {
    expectAllParse(expenseCategoryDtoSchema, fixtures.expenseCategories);
    expectUniqueIds(fixtures.expenseCategories);
    const roots = EXPENSE_CATEGORY_FIXTURES.filter((c) => c.parentId === null);
    expect(roots.map((c) => c.name)).toEqual([
      "Infraestructura",
      "Software y SaaS",
      "IA",
      "Dominios",
      "Freelancers",
      "Comisiones e impuestos",
      "Oficina",
      "Marketing",
      "Legal y contable",
      "Otros",
    ]);
    const rootIds = new Set(roots.map((c) => c.id));
    for (const child of EXPENSE_CATEGORY_FIXTURES.filter((c) => c.parentId !== null)) {
      expect(rootIds.has(child.parentId as string)).toBe(true);
    }
  });

  it("about 60 technologies with valid, unique slugs", () => {
    expectAllParse(technologyRowSchema, fixtures.technologies);
    expect(TECHNOLOGY_FIXTURES.length).toBeGreaterThanOrEqual(55);
    expect(TECHNOLOGY_FIXTURES.length).toBeLessThanOrEqual(70);
    expectUniqueIds(fixtures.technologies);
    expect(new Set(fixtures.technologies.map((t) => t.slug)).size).toBe(
      fixtures.technologies.length,
    );
  });

  it("tags", () => {
    expectAllParse(tagRowSchema, fixtures.tags);
    expectUniqueIds(fixtures.tags);
  });

  it("fiscal settings carry ivaRates 16/8/0 with 16 as the default, and company settings parse", () => {
    const fiscal = fiscalSettingsSchema.parse(fixtures.fiscal);
    expect(fiscal.ivaRates).toEqual(["16", "8", "0"]);
    expect(fiscal.ivaDefaultRate).toBe("16");
    expect(fiscal.igtfRate).toBe("3");
    expect(fiscal.invoiceDefaultDueDays).toBe(15);
    expect(companySettingsSchema.safeParse(fixtures.company).success).toBe(true);
  });

  it("mock users parse and include the two session users", () => {
    expectAllParse(userDetailSchema, fixtures.users);
    expectUniqueIds(fixtures.users);
    for (const sessionUser of MOCK_USERS) {
      const detail = fixtures.users.find((user) => user.id === sessionUser.id);
      expect(detail).toBeDefined();
      expect(detail?.name).toBe(sessionUser.name);
      expect(detail?.email).toBe(sessionUser.email);
      expect(detail?.role).toBe(sessionUser.role);
    }
    expect(
      fixtures.users.map((u) => u.role).every((r) => userRoleSchema.safeParse(r).success),
    ).toBe(true);
  });
});

describe("exchange rate history", () => {
  const ves = fixtures.exchangeRates.filter((r) => r.currency === "VES" && r.source === "BCV");

  it("holds the latest VES BCV rate at 755.16", () => {
    const latest = [...ves].sort((a, b) => b.date.localeCompare(a.date))[0];
    expect(latest?.date).toBe(TODAY);
    expect(toDecimal(latest?.usdRate ?? "0").equals(LATEST_VES_RATE)).toBe(true);
  });

  it("covers business days only, over the last ~90 days, with exactly one business day missing", () => {
    const dates = new Set(ves.map((r) => r.date));
    expect([...dates].every(isBusinessDay)).toBe(true);
    const oldest = [...dates].sort()[0] as string;
    expect(oldest >= addDays(TODAY, -RATE_HISTORY_DAYS)).toBe(true);
    expect(oldest <= addDays(TODAY, -RATE_HISTORY_DAYS + 4)).toBe(true);

    const missing: string[] = [];
    for (let back = 0; back <= RATE_HISTORY_DAYS; back += 1) {
      const date = addDays(TODAY, -back);
      if (date >= oldest && isBusinessDay(date) && !dates.has(date)) missing.push(date);
    }
    expect(missing).toHaveLength(1);
    // 5 business days back from Friday 9 Oct is Friday 2 Oct.
    expect(MISSING_RATE_BUSINESS_DAY_OFFSET).toBe(5);
    expect(missing[0]).toBe("2026-10-02");
  });

  it("stays around 755 (no jump over the whole history)", () => {
    for (const row of ves) {
      const value = toDecimal(row.usdRate);
      expect(value.greaterThan(700)).toBe(true);
      expect(value.lessThan(760)).toBe(true);
    }
  });

  it("offers several sources on the latest day, BCV first (DT-67)", () => {
    const selected = selectRate(fixtures.exchangeRates, TODAY, "VES");
    expect(selected?.options.map((o) => o.source)).toEqual(["BCV", "OTRA"]);
  });

  it("falls back to the previous day on the missing business day", () => {
    const selected = selectRate(fixtures.exchangeRates, "2026-10-02", "VES");
    expect(selected?.isFallback).toBe(true);
    expect(selected?.effectiveDate).toBe("2026-10-01");
  });

  it("produces fresh copies on every call", () => {
    const a = createCatalogFixtures(TODAY);
    const b = createCatalogFixtures(TODAY);
    a.currencies[0]!.name = "changed";
    expect(b.currencies[0]!.name).not.toBe("changed");
  });
});

describe("slugifyTechnology", () => {
  it("builds kebab slugs", () => {
    expect(slugifyTechnology("Next.js")).toBe("next-js");
    expect(slugifyTechnology("C#")).toBe("c-sharp");
    expect(slugifyTechnology("Tailwind CSS")).toBe("tailwind-css");
  });
});
