import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toOpenInvoiceOption } from "../open-invoice";
import { makeOpenInvoice } from "../test-fixtures";
import { AllocatePaymentSheet, type AllocatablePayment } from "./allocate-payment-sheet";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({
  allocatePaymentAction: vi.fn(),
  listOpenInvoicesAction: vi.fn(),
  refresh: vi.fn(),
  onOpenChange: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/payments/actions", () => ({
  allocatePaymentAction: mocks.allocatePaymentAction,
  listOpenInvoicesAction: mocks.listOpenInvoicesAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const usdPayment: AllocatablePayment = {
  id: "pay_1",
  clientId: "cli_1",
  currency: "USD",
  usdRate: "1",
  unallocated: "97.00",
};
const vesPayment: AllocatablePayment = {
  ...usdPayment,
  currency: "VES",
  usdRate: "36.5",
  unallocated: "3541.00",
};

const invoice = toOpenInvoiceOption(makeOpenInvoice({ balance: "300.00" }));

function renderSheet(payment = usdPayment) {
  return renderWithIntl(
    <AllocatePaymentSheet payment={payment} open onOpenChange={mocks.onOpenChange} />,
  );
}

beforeAll(installResizeObserver);
beforeEach(() => {
  for (const mock of [
    mocks.allocatePaymentAction,
    mocks.listOpenInvoicesAction,
    mocks.refresh,
    mocks.onOpenChange,
    mocks.toast.success,
    mocks.toast.error,
  ]) {
    mock.mockReset();
  }
  mocks.listOpenInvoicesAction.mockResolvedValue({ ok: true, data: [invoice] });
  mocks.allocatePaymentAction.mockResolvedValue({ ok: true, data: { id: "alc_1" } });
});

describe("AllocatePaymentSheet (PRD §8.6, HU-13 CA5)", () => {
  it("lists the open invoices of the payment's client with their balance", async () => {
    renderSheet();
    expect(await screen.findByText("FAC-0001")).toBeInTheDocument();
    expect(mocks.listOpenInvoicesAction).toHaveBeenCalledWith({ clientId: "cli_1" });
    expect(screen.getByText("Credit left on this payment")).toBeInTheDocument();
  });

  it("says so when the client has no open invoices", async () => {
    mocks.listOpenInvoicesAction.mockResolvedValue({ ok: true, data: [] });
    renderSheet();
    expect(await screen.findByText("The client has no open invoices.")).toBeInTheDocument();
  });

  it("allocates a same-currency row with both amounts and refreshes the page", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("checkbox", { name: "FAC-0001" }));
    await user.type(screen.getByLabelText("Amount in USD"), "50.00");
    expect(screen.getByLabelText("Amount in USD (invoice)")).toHaveValue("50.00");
    await user.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() =>
      expect(mocks.allocatePaymentAction).toHaveBeenCalledWith({
        paymentId: "pay_1",
        invoiceId: "inv_1",
        amountPaymentCurrency: "50.00",
        amountInvoiceCurrency: "50.00",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.toast.success).toHaveBeenCalledWith("Payment allocated");
  });

  it("shows the proposed invoice-currency amount of a VES payment and sends the edited value (rule 22)", async () => {
    const user = userEvent.setup();
    renderSheet(vesPayment);
    await user.click(await screen.findByRole("checkbox", { name: "FAC-0001" }));
    await user.type(screen.getByLabelText("Amount in VES"), "3650");
    const invoiceAmount = screen.getByLabelText("Amount in USD (invoice)");
    expect(invoiceAmount).toHaveValue("100.00");
    await user.clear(invoiceAmount);
    await user.type(invoiceAmount, "98.50");
    await user.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() => expect(mocks.allocatePaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.allocatePaymentAction.mock.calls[0]?.[0]).toEqual({
      paymentId: "pay_1",
      invoiceId: "inv_1",
      amountPaymentCurrency: "3650",
      amountInvoiceCurrency: "98.50",
    });
  });

  it("keeps the sheet open and marks the row on a duplicate live allocation (CONFLICT)", async () => {
    mocks.allocatePaymentAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: {
          "allocations.0.invoiceId": ["payments.validation.duplicateInvoiceAllocation"],
        },
      },
    });
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("checkbox", { name: "FAC-0001" }));
    await user.type(screen.getByLabelText("Amount in USD"), "50.00");
    await user.click(screen.getByRole("button", { name: "Allocate" }));

    const row = (
      await screen.findByText("The invoice already has an allocation in this payment")
    ).closest("[data-slot=allocation-row]");
    expect(within(row as HTMLElement).getByText("FAC-0001")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("maps an over-allocation 422 at its path", async () => {
    mocks.allocatePaymentAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: {
          "allocations.0.amountInvoiceCurrency": ["payments.validation.allocationExceedsBalance"],
        },
      },
    });
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("checkbox", { name: "FAC-0001" }));
    await user.type(screen.getByLabelText("Amount in USD"), "500.00");
    await user.click(screen.getByRole("button", { name: "Allocate" }));
    expect(await screen.findByText("The amount exceeds the invoice balance")).toBeInTheDocument();
  });

  it("does nothing until a row is ticked with an amount", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByText("FAC-0001");
    expect(screen.getByRole("button", { name: "Allocate" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "FAC-0001" }));
    expect(screen.getByRole("button", { name: "Allocate" })).toBeDisabled();
    expect(mocks.allocatePaymentAction).not.toHaveBeenCalled();
  });
});
