import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentResponseDto } from "@/lib/api/types/payments";
import { makeOpenInvoice, makePayment } from "../test-fixtures";
import { toOpenInvoiceOption } from "../open-invoice";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({
  createPaymentAction: vi.fn(),
  updatePaymentAction: vi.fn(),
  detectDuplicatePaymentAction: vi.fn(),
  listOpenInvoicesAction: vi.fn(),
  lookupRateAction: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/payments/actions", () => ({
  createPaymentAction: mocks.createPaymentAction,
  updatePaymentAction: mocks.updatePaymentAction,
  detectDuplicatePaymentAction: mocks.detectDuplicatePaymentAction,
  listOpenInvoicesAction: mocks.listOpenInvoicesAction,
}));
vi.mock("@/features/catalogs/actions", () => ({ lookupRateAction: mocks.lookupRateAction }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("@/components/ui/uploader", () => ({
  Uploader: ({ onChange }: { onChange?: (files: { id: string }[]) => void }) => (
    <button type="button" onClick={() => onChange?.([{ id: "fil_confirmed" }])}>
      Mock upload
    </button>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { PaymentForm, type PaymentFormProps } from "./payment-form";

const zelle = {
  id: "pmt_zelle",
  code: "ZELLE",
  name: "Zelle",
  nameEn: "Zelle",
  requiresReference: true,
  suggestsIgtf: true,
};
const transfer = {
  id: "pmt_transfer",
  code: "TRANSFER",
  name: "Transfer",
  nameEn: "Transfer",
  requiresReference: false,
  suggestsIgtf: false,
};

const props: PaymentFormProps = {
  clients: [{ id: "cli_kairos", name: "Kairos Studio" }],
  accounts: [{ id: "acc_zelle", name: "Zelle USD", currency: "USD" }],
  methods: [zelle],
  fiscal: { igtfRate: "3", igtfCurrencies: [] },
  today: "2026-10-09",
  initialOpenInvoices: [],
};

const vesProps: PaymentFormProps = {
  ...props,
  accounts: [{ id: "acc_ves", name: "Banesco VES", currency: "VES" }],
  methods: [transfer],
  initialClientId: "cli_kairos",
  initialOpenInvoices: [toOpenInvoiceOption(makeOpenInvoice({ balance: "100.00" }))],
  initialInvoiceId: "inv_1",
};

const rate = {
  usdRate: "36.5",
  isFallback: false,
  effectiveDate: "2026-10-09",
  source: "BCV",
  options: [{ source: "BCV", usdRate: "36.5", createdAt: "2026-10-09T12:00:00.000Z" }],
};

beforeAll(installResizeObserver);
beforeEach(() => {
  for (const mock of [
    mocks.createPaymentAction,
    mocks.updatePaymentAction,
    mocks.detectDuplicatePaymentAction,
    mocks.listOpenInvoicesAction,
    mocks.lookupRateAction,
    mocks.push,
    mocks.toast.success,
    mocks.toast.error,
  ]) {
    mock.mockReset();
  }
  mocks.lookupRateAction.mockResolvedValue({ ok: true, data: null });
  mocks.detectDuplicatePaymentAction.mockResolvedValue({
    ok: true,
    data: { duplicate: false, matches: [] },
  });
});

/** Fills the VES form so that 3650 VES is allocated to the USD invoice (HU-13 CA4). */
async function fillCrossCurrencyAllocation(user: ReturnType<typeof userEvent.setup>) {
  mocks.lookupRateAction.mockResolvedValue({ ok: true, data: rate });
  renderWithIntl(<PaymentForm {...vesProps} />);
  await waitFor(() =>
    expect(Number(screen.getByLabelText(/Rate of the day/).getAttribute("value") ?? "0")).toBe(
      36.5,
    ),
  );
  await user.type(screen.getByLabelText(/Amount received/), "3650");
  await user.type(screen.getByLabelText("Amount in VES"), "3650");
}

describe("PaymentForm (create)", () => {
  it("proposes the IGTF of the amount received when the method suggests it (DT-70)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText(/Amount received/), "100");
    await waitFor(() => expect(screen.getByLabelText("IGTF")).toHaveValue("3.00"));
  });

  it("proposes the IGTF from igtfCurrencies for a method that does not suggest it, and sends an edited IGTF as typed", async () => {
    mocks.createPaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    renderWithIntl(
      <PaymentForm
        {...props}
        methods={[{ ...transfer }]}
        fiscal={{ igtfRate: "3", igtfCurrencies: ["USD"] }}
      />,
    );
    await user.type(screen.getByLabelText(/Amount received/), "100");
    await waitFor(() => expect(screen.getByLabelText("IGTF")).toHaveValue("3.00"));

    await user.clear(screen.getByLabelText("IGTF"));
    await user.type(screen.getByLabelText("IGTF"), "5.00");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(mocks.createPaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.createPaymentAction.mock.calls[0]?.[0]).toMatchObject({
      amount: "100",
      igtfAmount: "5.00",
      feeAmount: "0.00",
      currency: "USD",
      usdRate: "1",
    });
    expect(mocks.push).toHaveBeenCalledWith("/payments/pay_1");
  });

  it("does not propose IGTF for a method and currency that neither suggest it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} methods={[{ ...transfer }]} />);
    await user.type(screen.getByLabelText(/Amount received/), "100");
    expect(screen.getByLabelText("IGTF")).toHaveValue("0.00");
  });

  it("asks for the reference when the method requires it (CA1)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText(/Amount received/), "10");
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(
      await screen.findByText("The reference is required for this payment method"),
    ).toBeInTheDocument();
    expect(mocks.createPaymentAction).not.toHaveBeenCalled();
  });

  it("requires the amount (CA1)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} methods={[transfer]} />);
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getAllByText(/./).length).toBeGreaterThan(0));
    expect(mocks.createPaymentAction).not.toHaveBeenCalled();
  });

  it("marks #payment-amount aria-invalid on empty submit", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} methods={[transfer]} />);
    const amount = screen.getByLabelText(/Amount received/);
    expect(amount).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(amount).toHaveAttribute("aria-invalid", "true"));
    expect(amount).toHaveAttribute("id", "payment-amount");
  });

  it("sends the receipt file id of the confirmed upload (HU-14 CA1)", async () => {
    mocks.createPaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} methods={[transfer]} />);
    await user.type(screen.getByLabelText(/Amount received/), "50");
    await user.click(screen.getByRole("button", { name: "Mock upload" }));
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(mocks.createPaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.createPaymentAction.mock.calls[0]?.[0]).toMatchObject({
      receiptFileId: "fil_confirmed",
    });
  });

  it("shows an unknown receipt (NOT_FOUND) as the error toast and stays on the form", async () => {
    mocks.createPaymentAction.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" },
    });
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} methods={[transfer]} />);
    await user.type(screen.getByLabelText(/Amount received/), "50");
    await user.click(screen.getByRole("button", { name: "Mock upload" }));
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/./)));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("PaymentForm allocations (HU-13 CA3, CA4)", () => {
  it("shows the proposed invoice-currency amount from the payment-date rate, and sends the edited value", async () => {
    mocks.createPaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    await fillCrossCurrencyAllocation(user);

    const invoiceAmount = screen.getByLabelText("Amount in USD (invoice)");
    await waitFor(() => expect(invoiceAmount).toHaveValue("100.00"));

    await user.clear(invoiceAmount);
    await user.type(invoiceAmount, "98.50");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(mocks.createPaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.createPaymentAction.mock.calls[0]?.[0]).toMatchObject({
      currency: "VES",
      allocations: [
        { invoiceId: "inv_1", amountPaymentCurrency: "3650", amountInvoiceCurrency: "98.50" },
      ],
    });
  });

  it("sends the proposal as shown when the user leaves the field alone", async () => {
    mocks.createPaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    await fillCrossCurrencyAllocation(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Amount in USD (invoice)")).toHaveValue("100.00"),
    );
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(mocks.createPaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.createPaymentAction.mock.calls[0]?.[0].allocations).toEqual([
      { invoiceId: "inv_1", amountPaymentCurrency: "3650", amountInvoiceCurrency: "100.00" },
    ]);
  });

  it("sends no hidden invoice-currency amount when the field is emptied", async () => {
    const user = userEvent.setup();
    await fillCrossCurrencyAllocation(user);
    const invoiceAmount = screen.getByLabelText("Amount in USD (invoice)");
    await waitFor(() => expect(invoiceAmount).toHaveValue("100.00"));
    await user.clear(invoiceAmount);
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(
      await screen.findByText("Enter the amount to apply in both currencies"),
    ).toBeInTheDocument();
    expect(mocks.createPaymentAction).not.toHaveBeenCalled();
  });

  it("maps an over-allocation 422 at its path (CA3)", async () => {
    mocks.createPaymentAction.mockResolvedValue({
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
    await fillCrossCurrencyAllocation(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Amount in USD (invoice)")).toHaveValue("100.00"),
    );
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    const row = (await screen.findByText("The amount exceeds the invoice balance")).closest(
      "[data-slot=allocation-row]",
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("FAC-0001")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("maps the total over-allocation of the payment to the allocations section", async () => {
    mocks.createPaymentAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { allocations: ["payments.validation.allocationsExceedAllocatable"] },
      },
    });
    const user = userEvent.setup();
    await fillCrossCurrencyAllocation(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Amount in USD (invoice)")).toHaveValue("100.00"),
    );
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(
      await screen.findByText("The allocations exceed the allocatable amount"),
    ).toBeInTheDocument();
  });

  it("maps a duplicate live allocation (CONFLICT) onto its row", async () => {
    mocks.createPaymentAction.mockResolvedValue({
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
    await fillCrossCurrencyAllocation(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Amount in USD (invoice)")).toHaveValue("100.00"),
    );
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    const row = (
      await screen.findByText("The invoice already has an allocation in this payment")
    ).closest("[data-slot=allocation-row]");
    expect(within(row as HTMLElement).getByText("FAC-0001")).toBeInTheDocument();
  });
});

describe("PaymentForm duplicate warning (CA6)", () => {
  it("warns about a possible duplicate without refusing the payment", async () => {
    mocks.detectDuplicatePaymentAction.mockResolvedValue({
      ok: true,
      data: {
        duplicate: true,
        matches: [
          {
            payment: {
              id: "pag_kairos_partial",
              code: "PAG-0001",
              label: "PAG-0001",
              type: "PAYMENT",
            },
            date: "2026-09-25",
            amount: "300.00",
            currency: "USD",
            status: "CONFIRMADO",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText("Reference"), "ZL-MOCK-0001");
    expect(
      await screen.findByText("Possible duplicate", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PAG-0001/)).toBeInTheDocument();
    expect(mocks.detectDuplicatePaymentAction).toHaveBeenCalledWith({
      methodId: "pmt_zelle",
      accountId: "acc_zelle",
      reference: "ZL-MOCK-0001",
    });
  });
});

describe("PaymentForm (edit, DT-213)", () => {
  const live = makePayment({
    allocated: "50.00",
    unallocated: "47.00",
    allocations: [
      {
        id: "alc_1",
        paymentId: "pay_1",
        invoice: { id: "inv_1", code: "FAC-0001", label: "FAC-0001", type: "INVOICE" },
        invoiceCurrency: "USD",
        amountPaymentCurrency: "50.00",
        amountInvoiceCurrency: "50.00",
        amountUsd: "50.00",
        createdAt: "2026-10-06T12:00:00.000Z",
      },
    ],
  });
  const editProps: PaymentFormProps = {
    ...props,
    accounts: [{ id: "acc_usd", name: "Zelle USD (MOCK)", currency: "USD", active: true }],
    methods: [{ ...zelle, id: "pm_zelle", active: true }],
    clients: [{ id: "cli_1", name: "Kairos Studio (MOCK)" }],
  };

  function renderEdit(payment: PaymentResponseDto = live, extra: Partial<PaymentFormProps> = {}) {
    return renderWithIntl(<PaymentForm {...editProps} {...extra} payment={payment} />);
  }

  it("starts from the stored payment, without the allocations section", () => {
    renderEdit();
    expect(screen.getByRole("heading", { name: "Edit payment" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount received/)).toHaveValue("100.00");
    expect(screen.getByLabelText("IGTF")).toHaveValue("3.00");
    expect(screen.getByLabelText("Reference")).toHaveValue("ZL-MOCK-0001");
    expect(screen.queryByText("Apply to invoices")).not.toBeInTheDocument();
  });

  it("disables the client and the account while the payment has live allocations", () => {
    renderEdit();
    expect(screen.getByRole("combobox", { name: "Client" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Destination account" })).toBeDisabled();
  });

  it("keeps them enabled when nothing is allocated", () => {
    renderEdit(makePayment());
    expect(screen.getByRole("combobox", { name: "Client" })).toBeEnabled();
  });

  it("patches through updatePaymentAction with the id and without allocations or status", async () => {
    mocks.updatePaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    renderEdit(makePayment());
    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "ZL-FIXED");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updatePaymentAction).toHaveBeenCalledTimes(1));
    const sent = mocks.updatePaymentAction.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      id: "pay_1",
      clientId: "cli_1",
      accountId: "acc_usd",
      methodId: "pm_zelle",
      amount: "100.00",
      igtfAmount: "3.00",
      reference: "ZL-FIXED",
    });
    expect(sent).not.toHaveProperty("allocations");
    expect(sent).not.toHaveProperty("status");
    expect(mocks.createPaymentAction).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/payments/pay_1");
  });

  it("does not overwrite the stored IGTF with a new proposal", async () => {
    const user = userEvent.setup();
    renderEdit(makePayment({ igtfAmount: "1.00" }));
    await user.clear(screen.getByLabelText(/Amount received/));
    await user.type(screen.getByLabelText(/Amount received/), "200");
    expect(screen.getByLabelText("IGTF")).toHaveValue("1.00");
  });

  it("excludes the payment itself from the duplicate check", async () => {
    const user = userEvent.setup();
    renderEdit(makePayment());
    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "ZL-NEW");
    await waitFor(
      () =>
        expect(mocks.detectDuplicatePaymentAction).toHaveBeenCalledWith({
          methodId: "pm_zelle",
          accountId: "acc_usd",
          reference: "ZL-NEW",
          excludePaymentId: "pay_1",
        }),
      { timeout: 2000 },
    );
  });

  it("shows the INTEGRITY_LOCK of a client change with live allocations", async () => {
    mocks.updatePaymentAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "payments.errors.clientLocked" },
    });
    const user = userEvent.setup();
    renderEdit(live);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "The client and the currency cannot change while the payment has allocations",
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows the 'amount below what is allocated' refusal", async () => {
    mocks.updatePaymentAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "payments.errors.allocatableBelowAllocated" },
    });
    const user = userEvent.setup();
    renderEdit(live);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "The amount cannot be lower than what is already allocated",
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not navigate when the save fails", async () => {
    mocks.updatePaymentAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "common.errors.CONFLICT" },
    });
    const user = userEvent.setup();
    renderEdit(live);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows a deactivated account and method of the payment, labelled inactive (rule 23)", () => {
    renderEdit(makePayment(), {
      accounts: [{ id: "acc_usd", name: "Zelle USD (MOCK)", currency: "USD", active: false }],
      methods: [{ ...zelle, id: "pm_zelle", active: false }],
    });
    expect(screen.getByRole("combobox", { name: "Destination account" })).toHaveTextContent(
      /Zelle USD \(MOCK\).*inactive/i,
    );
    expect(screen.getByRole("combobox", { name: "Method" })).toHaveTextContent(/inactive/i);
  });

  it("shows a client the picker no longer offers from the payment's own label (rule 23)", () => {
    renderEdit(makePayment(), { clients: [] });
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveTextContent(
      /Kairos Studio \(MOCK\).*inactive/i,
    );
  });
});
