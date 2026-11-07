import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAccounts from "@/i18n/messages/en/accounts.json";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";

const mocks = vi.hoisted(() => ({
  reconcileAccountAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/accounts/actions", () => ({
  reconcileAccountAction: mocks.reconcileAccountAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { ReconciliationForm } from "./reconciliation-form";

function renderForm() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{ accounts: enAccounts, common: enCommon, patterns: enPatterns }}
    >
      <ReconciliationForm accountId="acc_a" currency="USD" today="2026-11-01" />
    </NextIntlClientProvider>,
  );
}

const stored = {
  id: "rec_1",
  accountId: "acc_a",
  date: "2026-11-01",
  statementBalance: "120.00",
  systemBalance: "100.00",
  difference: "20.00",
  notes: null,
  createdAt: "2026-11-01T12:00:00.000Z",
};

beforeEach(() => {
  mocks.reconcileAccountAction.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});

describe("ReconciliationForm (HU-15 CA3, DT-123)", () => {
  it("sends the statement balance as typed and shows the figures the BE returned", async () => {
    mocks.reconcileAccountAction.mockResolvedValue({
      ok: true,
      data: { ...stored, suggestedAdjustment: "20.00" },
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Statement balance"), "120.00");
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));

    await waitFor(() =>
      expect(mocks.reconcileAccountAction).toHaveBeenCalledWith({
        accountId: "acc_a",
        date: "2026-11-01",
        statementBalance: "120.00",
      }),
    );
    expect(await screen.findByText("System balance")).toBeInTheDocument();
    expect(mocks.toast.success).toHaveBeenCalledWith("Reconciliation recorded");
    // The AJUSTE is a separate movement, prefilled with the suggestion and never recorded here.
    const link = screen.getByRole("link", { name: "Record adjustment" });
    expect(link).toHaveAttribute(
      "href",
      "/accounts/movements/new?accountId=acc_a&type=AJUSTE&date=2026-11-01&amount=20.00",
    );
  });

  it("offers no adjustment when the BE returns no suggestion", async () => {
    mocks.reconcileAccountAction.mockResolvedValue({
      ok: true,
      data: { ...stored, statementBalance: "100.00", difference: "0.00", suggestedAdjustment: null },
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Statement balance"), "100.00");
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));

    expect(await screen.findByText(/No difference/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Record adjustment" })).toBeNull();
  });

  it("shows the error toast and no figures when the BE refuses", async () => {
    mocks.reconcileAccountAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Statement balance"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(screen.queryByText("System balance")).toBeNull();
  });
});
