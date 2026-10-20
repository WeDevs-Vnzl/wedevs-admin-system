import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" }));

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "es",
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/features/settings/queries", async () => {
  const { can } = await import("@/server/auth/permissions");
  const { makeSessionUser } = await import("@/mocks/test-helpers");
  return {
    // The real access rule of the settings section: `read` on `settings` (Owner and Admin).
    getOpenableSettingsSection: async (slug: string) =>
      can(makeSessionUser(state.role), "read", "settings") ? { slug } : null,
  };
});
vi.mock("@/features/catalogs/queries", async () => {
  const { DEFAULT_FISCAL_SETTINGS } = await import("@/lib/validators/settings");
  return {
    listCurrencies: async () => [],
    listPaymentMethods: async () => [],
    listExpenseCategories: async () => [],
    getFiscalSettings: async () => DEFAULT_FISCAL_SETTINGS,
    listExchangeRates: async () => ({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 }),
    exchangeRateFilterFromParams: () => ({ page: 1, pageSize: 25 }),
    getQuickLoadContext: async () => ({ today: "2026-10-13", currencies: [] }),
  };
});

import CurrenciesPage from "./currencies/page";
import ExpenseCategoriesPage from "./expense-categories/page";
import FiscalSettingsPage from "./fiscal/page";
import PaymentMethodsPage from "./payment-methods/page";
import RatesPage from "./rates/page";

const pages = {
  "/settings/currencies": () => CurrenciesPage(),
  "/settings/rates": () => RatesPage({ searchParams: Promise.resolve({}) }),
  "/settings/fiscal": () => FiscalSettingsPage(),
  "/settings/payment-methods": () => PaymentMethodsPage(),
  "/settings/expense-categories": () => ExpenseCategoriesPage(),
};

describe.each(Object.entries(pages))("%s access", (_route, render) => {
  it.each(["OWNER", "ADMIN"] as const)("renders for %s", async (role) => {
    state.role = role;
    await expect(render()).resolves.toBeTruthy();
  });

  it.each(["MEMBER", "VIEWER"] as const)("calls notFound() for %s", async (role) => {
    state.role = role;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
