import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enInvoices from "@/i18n/messages/en/invoices.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { createInvoiceAction, updateInvoiceAction } from "@/features/invoices/actions";
import type { BillableInstallmentRow } from "@/lib/validators/invoices";
import { multiRateInvoice } from "../test-data";
import { InvoiceForm, type InvoiceFormProps } from "./invoice-form";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/invoices/actions", () => ({
  createInvoiceAction: vi.fn(),
  updateInvoiceAction: vi.fn(),
  listBillableInstallmentsAction: vi.fn(),
}));

const messages = {
  common: enCommon,
  enums: enEnums,
  invoices: enInvoices,
  patterns: enPatterns,
  table: enTable,
  validation: enValidation,
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const baseProps: InvoiceFormProps = {
  clients: [{ id: "cli_1", name: "Kairos Studio" }],
  currencies: [{ code: "USD", name: "US dollar" }],
  ivaRates: ["16", "8", "0"],
  defaultIvaRate: "16",
  today: "2026-10-09",
  defaultDueDays: 15,
  initialClientId: "cli_1",
  billable: [],
  preselected: [],
};

function renderForm(props: Partial<InvoiceFormProps> = {}) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="America/Caracas" messages={messages}>
      <InvoiceForm {...baseProps} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("InvoiceForm edit (HU-11, C17)", () => {
  it("sends the per-line rates incl. exempt and only the non-zero adjustments; a BE 422 lands on the adjustment", async () => {
    const user = userEvent.setup();
    vi.mocked(updateInvoiceAction).mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: {
          "taxAdjustments.0.adjustment": ["invoices.validation.adjustmentOutOfRange"],
        },
      },
    });
    renderForm({ invoice: multiRateInvoice() });

    const adjustment = screen.getByLabelText("VAT adjustment 16 % (±0.01)");
    await user.clear(adjustment);
    await user.type(adjustment, "0.02");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(updateInvoiceAction).mock.calls[0]?.[0];
    expect(sent?.id).toBe("inv_1");
    expect(sent?.lines.map((line) => line.ivaRate)).toEqual(["16", "8", "0", null]);
    expect(sent?.taxAdjustments).toEqual([{ ivaRate: "16", adjustment: "0.02" }]);

    expect(await screen.findByText("The VAT adjustment cannot exceed ±0.01")).toBeInTheDocument();
    expect(screen.getByLabelText("VAT adjustment 16 % (±0.01)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("accepts a 0.01 adjustment, goes to the detail where the BE totals are shown", async () => {
    const user = userEvent.setup();
    vi.mocked(updateInvoiceAction).mockResolvedValue({ ok: true, data: multiRateInvoice() });
    renderForm({ invoice: multiRateInvoice() });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invoices/inv_1"));
    expect(vi.mocked(updateInvoiceAction).mock.calls[0]?.[0].taxAdjustments).toEqual([
      { ivaRate: "16", adjustment: "0.01" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Invoice saved");
  });

  it("labels the totals panel as a preview", () => {
    renderForm({ invoice: multiRateInvoice() });
    expect(screen.getByText("Totals (preview)")).toBeInTheDocument();
  });

  it("shows a taken number on the field with a link to the invoice that holds it (choice 2)", async () => {
    const user = userEvent.setup();
    vi.mocked(updateInvoiceAction).mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "invoices.errors.numberTaken",
        fieldErrors: { invoiceNumber: ["invoices.errors.numberTaken"] },
        entity: { type: "INVOICE", id: "inv_9", code: "FAC-0009", label: "00001234" },
      },
    });
    renderForm({ invoice: multiRateInvoice() });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("An invoice with this number already exists"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open invoice FAC-0009" })).toHaveAttribute(
      "href",
      "/invoices/inv_9",
    );
    expect(mocks.toast.error).toHaveBeenCalledWith("An invoice with this number already exists");
  });
});

describe("InvoiceForm create", () => {
  const row: BillableInstallmentRow = {
    installment: { type: "INSTALLMENT", id: "ins_1", label: "Anticipo" },
    project: { type: "PROJECT", id: "prj_1", label: "Portal" },
    kind: "ANTICIPO",
    label: "Anticipo 40 %",
    currency: "USD",
    amount: "4000.00",
    remainingAmount: "3000.00",
    dueDate: null,
  };

  it("bills a pending installment (wire null code parsed to undefined): one line at the remaining amount", async () => {
    const user = userEvent.setup();
    vi.mocked(createInvoiceAction).mockResolvedValue({ ok: true, data: multiRateInvoice() });
    renderForm({ billable: [row] });

    await user.click(screen.getByRole("checkbox", { name: "Bill the installment Anticipo 40 %" }));
    expect(screen.getByDisplayValue("Anticipo 40 %")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3000.00")).toBeInTheDocument();
  });

  it("opens with the installments preselected from the URL", () => {
    renderForm({ billable: [row], preselected: [row] });
    expect(screen.getByDisplayValue("Anticipo 40 %")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Bill the installment Anticipo 40 %" }),
    ).toBeChecked();
  });
});
