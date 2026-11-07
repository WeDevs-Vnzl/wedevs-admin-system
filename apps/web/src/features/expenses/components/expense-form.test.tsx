import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esExpenses from "@/i18n/messages/es/expenses.json";
import esForms from "@/i18n/messages/es/forms.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { ExpenseFormOptions } from "../form-options";
import { makeExpense } from "../test-fixtures";

const mocks = vi.hoisted(() => ({
  createExpenseAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  lookupRateAction: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/expenses/actions", () => ({
  createExpenseAction: mocks.createExpenseAction,
  updateExpenseAction: mocks.updateExpenseAction,
}));
vi.mock("@/features/catalogs/actions", () => ({ lookupRateAction: mocks.lookupRateAction }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { ExpenseForm } from "./expense-form";

const options: ExpenseFormOptions = {
  categories: [{ id: "cat_hosting", label: "Infraestructura → Hosting (MOCK)" }],
  accounts: [{ id: "acc_ves", name: "Caja VES (MOCK)", currency: "VES" }],
  projects: [],
  currencies: [
    { code: "USD", name: "Dólar" },
    { code: "VES", name: "Bolívar" },
  ],
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  for (const mock of [
    mocks.createExpenseAction,
    mocks.updateExpenseAction,
    mocks.lookupRateAction,
    mocks.push,
    mocks.toast.success,
    mocks.toast.error,
  ]) {
    mock.mockReset();
  }
  mocks.lookupRateAction.mockResolvedValue({ ok: true, data: null });
});

function renderEdit(expense = makeExpense()) {
  return render(
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{
        common: esCommon,
        enums: esEnums,
        expenses: esExpenses,
        forms: esForms,
        patterns: esPatterns,
        validation: esValidation,
      }}
    >
      <ExpenseForm options={options} today="2026-10-09" expense={expense} />
    </NextIntlClientProvider>,
  );
}

describe("ExpenseForm in edit mode (Q-FEINT-11 (A))", () => {
  it("starts from the stored expense and hides the status", () => {
    renderEdit();
    expect(screen.getByRole("heading", { name: "Editar gasto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción")).toHaveValue("Hosting de producción (MOCK)");
    expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();
  });

  it("patches through updateExpenseAction with the id and without status or payment fields", async () => {
    mocks.updateExpenseAction.mockResolvedValue({ ok: true, data: makeExpense() });
    renderEdit();
    await userEvent.clear(screen.getByLabelText("Descripción"));
    await userEvent.type(screen.getByLabelText("Descripción"), "Hosting corregido (MOCK)");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mocks.updateExpenseAction).toHaveBeenCalledTimes(1));
    const sent = mocks.updateExpenseAction.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      id: "exp_1",
      description: "Hosting corregido (MOCK)",
      categoryId: "cat_hosting",
      currency: "USD",
      amount: "120.00",
      usdRate: "1",
    });
    expect(sent).not.toHaveProperty("status");
    expect(sent).not.toHaveProperty("paidAt");
    expect(mocks.createExpenseAction).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/expenses/exp_1");
  });

  it("shows the mapped notPending CONFLICT of a paid expense as the toast", async () => {
    mocks.updateExpenseAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "expenses.errors.notPending" },
    });
    renderEdit(makeExpense({ status: "PAGADO", paidAt: "2026-10-09" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Solo un gasto pendiente se puede marcar como pagado",
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows rateMissing on the currency field", async () => {
    mocks.updateExpenseAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { currency: ["expenses.errors.rateMissing"] },
      },
    });
    // The lookup is a lookup only (C16): it proposes the stored rate, the BE still decides on save.
    mocks.lookupRateAction.mockResolvedValue({
      ok: true,
      data: {
        usdRate: "0.02",
        isFallback: false,
        effectiveDate: "2026-10-05",
        source: "BCV",
        options: [{ source: "BCV", usdRate: "0.02", createdAt: "2026-10-05T12:00:00.000Z" }],
      },
    });
    renderEdit(makeExpense({ currency: "VES", amount: "100.00", usdRate: "0.02" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mocks.updateExpenseAction).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("No hay tasa de cambio para la moneda en la fecha indicada"),
    ).toBeInTheDocument();
  });
});
