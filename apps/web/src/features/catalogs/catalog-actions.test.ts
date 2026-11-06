import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  createCurrencyAction,
  createExpenseCategoryAction,
  createPaymentMethodAction,
  updateCurrencyAction,
  updateExpenseCategoryAction,
  updateFiscalSettingsAction,
  updatePaymentMethodAction,
} from "./actions";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.api = mocked.api;
  return mocked;
}

beforeEach(() => {
  server.api = null;
  cache.revalidatePath.mockReset();
});

const brl = { code: "BRL", name: "Real", symbol: "R$", decimals: 2, active: true };
const method = {
  id: "pm1",
  code: "BIZUM",
  name: "Bizum",
  nameEn: null,
  requiresReference: true,
  suggestsIgtf: false,
  active: true,
};
const category = {
  id: "c1",
  name: "Eventos",
  nameEn: null,
  color: null,
  parentId: null,
  active: true,
};
const fiscal = {
  ivaRates: ["16", "8", "0"],
  ivaDefaultRate: "16",
  igtfRate: "3",
  igtfCurrencies: ["USD"],
  invoiceDefaultDueDays: 15,
};

describe("currency actions", () => {
  it("creates a currency and revalidates the page", async () => {
    const { calls } = useApi({ "POST /api/v1/currencies": { status: 201, body: brl } });
    const result = await createCurrencyAction({
      code: "BRL",
      name: "Real",
      symbol: "R$",
      decimals: 2,
      active: true,
    });
    expect(result).toEqual({ ok: true, data: brl });
    expect(calls[0]?.body).toMatchObject({ code: "BRL", name: "Real" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/currencies");
  });

  it("updates by code without sending the code in the body (also deactivation)", async () => {
    const { calls } = useApi({
      "PATCH /api/v1/currencies/{code}": { body: { ...brl, active: false } },
    });
    const result = await updateCurrencyAction({ ...brl, active: false });
    expect(result).toMatchObject({ ok: true, data: { active: false } });
    expect(calls[0]?.path).toBe("/api/v1/currencies/BRL");
    expect(calls[0]?.body).toEqual({ name: "Real", symbol: "R$", decimals: 2, active: false });
  });

  it("maps USD deactivation to VALIDATION on the field and does not revalidate", async () => {
    useApi({
      "PATCH /api/v1/currencies/{code}": errorEnvelope("VALIDATION", {
        fieldErrors: { active: ["catalogs.currencies.errors.usdAlwaysActive"] },
      }),
    });
    const result = await updateCurrencyAction({ ...brl, code: "USD", active: false });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { active: ["catalogs.currencies.errors.usdAlwaysActive"] },
      },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for a Member and changes nothing", async () => {
    useApi({ "POST /api/v1/currencies": errorEnvelope("FORBIDDEN") });
    const result = await createCurrencyAction(brl);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("payment method actions", () => {
  it("creates and updates by id", async () => {
    const { calls } = useApi({
      "POST /api/v1/payment-methods": { status: 201, body: method },
      "PATCH /api/v1/payment-methods/{id}": { body: { ...method, name: "Bizum 2" } },
    });
    expect(
      await createPaymentMethodAction({
        code: "BIZUM",
        name: "Bizum",
        requiresReference: true,
        suggestsIgtf: false,
        active: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await updatePaymentMethodAction({
        id: "pm1",
        name: "Bizum 2",
        requiresReference: true,
        suggestsIgtf: false,
        active: true,
      }),
    ).toMatchObject({ ok: true, data: { name: "Bizum 2" } });
    expect(calls[1]?.path).toBe("/api/v1/payment-methods/pm1");
    expect(calls[1]?.body).not.toHaveProperty("id");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/payment-methods");
  });

  it("maps a duplicate code to CONFLICT on the field", async () => {
    useApi({
      "POST /api/v1/payment-methods": errorEnvelope("CONFLICT", {
        fieldErrors: { code: ["catalogs.paymentMethods.errors.codeTaken"] },
      }),
    });
    expect(
      await createPaymentMethodAction({
        code: "ZELLE",
        name: "Zelle 2",
        requiresReference: true,
        suggestsIgtf: false,
        active: true,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        fieldErrors: { code: ["catalogs.paymentMethods.errors.codeTaken"] },
      },
    });
  });
});

describe("expense category actions", () => {
  it("creates and updates by id", async () => {
    const { calls } = useApi({
      "POST /api/v1/expense-categories": { status: 201, body: category },
      "PATCH /api/v1/expense-categories/{id}": { body: category },
    });
    expect(await createExpenseCategoryAction({ name: "Eventos", active: true })).toMatchObject({
      ok: true,
    });
    expect(
      await updateExpenseCategoryAction({ id: "c1", name: "Eventos", active: true }),
    ).toMatchObject({ ok: true });
    expect(calls[1]?.path).toBe("/api/v1/expense-categories/c1");
    expect(calls[1]?.body).toEqual({ name: "Eventos", active: true });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/expense-categories");
  });

  it("maps a child under a child to VALIDATION on parentId", async () => {
    useApi({
      "POST /api/v1/expense-categories": errorEnvelope("VALIDATION", {
        fieldErrors: { parentId: ["catalogs.expenseCategories.errors.parentNotRoot"] },
      }),
    });
    expect(
      await createExpenseCategoryAction({ name: "Sub", parentId: "c2", active: true }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { parentId: ["catalogs.expenseCategories.errors.parentNotRoot"] },
      },
    });
  });
});

describe("fiscal settings action", () => {
  it("PATCHes decimal strings as they are, without the method code list the BE does not know", async () => {
    const { calls } = useApi({ "PATCH /api/v1/settings/fiscal": { body: fiscal } });
    const result = await updateFiscalSettingsAction({ ...fiscal, igtfMethodCodes: ["ZELLE"] });
    expect(result).toEqual({ ok: true, data: fiscal });
    expect(calls[0]?.body).toEqual(fiscal);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/fiscal");
  });

  it("maps a default VAT rate outside the allowed set to VALIDATION", async () => {
    useApi({
      "PATCH /api/v1/settings/fiscal": errorEnvelope("VALIDATION", {
        fieldErrors: { ivaDefaultRate: ["settings.validation.defaultIvaRateNotAllowed"] },
      }),
    });
    expect(
      await updateFiscalSettingsAction({ ...fiscal, ivaDefaultRate: "12", igtfMethodCodes: [] }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { ivaDefaultRate: ["settings.validation.defaultIvaRateNotAllowed"] },
      },
    });
  });
});
