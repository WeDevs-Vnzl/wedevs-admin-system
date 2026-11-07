import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esExpenses from "@/i18n/messages/es/expenses.json";
import esForms from "@/i18n/messages/es/forms.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { ExpenseResponseDto } from "@/lib/api/types/expenses";
import { makeExpense } from "../test-fixtures";
import { ExpenseDetail } from "./expense-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/features/catalogs/actions", () => ({ lookupRateAction: vi.fn() }));
vi.mock("@/features/expenses/actions", () => ({
  voidExpenseAction: vi.fn(),
  markExpensePaidAction: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderDetail(expense: ExpenseResponseDto) {
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
      <ExpenseDetail expense={expense} accounts={[]} today="2026-10-09" canUpdate />
    </NextIntlClientProvider>,
  );
}

describe("ExpenseDetail", () => {
  it("keeps the header: description, code and the pending actions", () => {
    const expense = makeExpense();
    renderDetail(expense);

    expect(
      screen.getByRole("heading", { level: 1, name: expense.description }),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${expense.code}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pagado" })).toBeInTheDocument();
  });

  it('offers the shared "Detalle | Grafo" toggle (A4)', () => {
    const expense = makeExpense();
    renderDetail(expense);

    expect(screen.getByRole("radiogroup", { name: "Vista" })).toBeInTheDocument();
    expect(screen.getByText("Detalle").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Grafo").closest("a")).toHaveAttribute(
      "href",
      `/expenses/${expense.id}/graph`,
    );
  });

  it('offers "Editar" for a pending expense only (cosmetic, Q-FEINT-11 (A))', () => {
    const pending = makeExpense();
    const { unmount } = renderDetail(pending);
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/expenses/${pending.id}/edit`,
    );
    unmount();

    renderDetail(makeExpense({ status: "PAGADO", paidAt: "2026-10-09" }));
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("shows the account debit exactly as the BE returned it", () => {
    renderDetail(makeExpense({ status: "PAGADO", accountAmount: "4380.00" }));
    expect(screen.getByText(/4380\.00/)).toBeInTheDocument();
  });
});
