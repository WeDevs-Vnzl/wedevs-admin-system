import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePayment } from "../test-fixtures";
import { PaymentAllocationsPanel } from "./payment-allocations-panel";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({
  deallocatePaymentAction: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/payments/actions", () => ({
  deallocatePaymentAction: mocks.deallocatePaymentAction,
  allocatePaymentAction: vi.fn(),
  listOpenInvoicesAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const allocation = {
  id: "alc_1",
  paymentId: "pay_1",
  invoice: { id: "inv_1", code: "FAC-0001", label: "FAC-0001", type: "INVOICE" as const },
  invoiceCurrency: "USD",
  amountPaymentCurrency: "50.00",
  amountInvoiceCurrency: "50.00",
  amountUsd: "50.00",
  createdAt: "2026-10-06T12:00:00.000Z",
};
const withRest = makePayment({
  allocations: [allocation],
  allocated: "50.00",
  unallocated: "47.00",
});

beforeAll(installResizeObserver);
beforeEach(() => {
  for (const mock of [
    mocks.deallocatePaymentAction,
    mocks.refresh,
    mocks.toast.success,
    mocks.toast.error,
  ]) {
    mock.mockReset();
  }
});

describe("PaymentAllocationsPanel", () => {
  it("offers Allocate on a confirmed payment with an unallocated rest", () => {
    renderWithIntl(<PaymentAllocationsPanel payment={withRest} canUpdate />);
    expect(screen.getByRole("button", { name: "Allocate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deallocate" })).toBeInTheDocument();
  });

  it("offers neither to a role that may not update (cosmetic)", () => {
    renderWithIntl(<PaymentAllocationsPanel payment={withRest} />);
    expect(screen.queryByRole("button", { name: "Allocate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deallocate" })).not.toBeInTheDocument();
    expect(screen.getByText("FAC-0001")).toBeInTheDocument();
  });

  it.each([
    ["without a rest", { unallocated: "0.00" }],
    ["on a pending payment", { status: "PENDIENTE_VERIFICACION" as const }],
    ["on a voided payment", { status: "ANULADO" as const }],
  ])("does not offer Allocate %s", (_name, overrides) => {
    renderWithIntl(<PaymentAllocationsPanel payment={makePayment(overrides)} canUpdate />);
    expect(screen.queryByRole("button", { name: "Allocate" })).not.toBeInTheDocument();
  });

  it("deallocates after confirmation and refreshes from the BE", async () => {
    mocks.deallocatePaymentAction.mockResolvedValue({ ok: true, data: makePayment() });
    const user = userEvent.setup();
    renderWithIntl(<PaymentAllocationsPanel payment={withRest} canUpdate />);
    await user.click(screen.getByRole("button", { name: "Deallocate" }));
    expect(mocks.deallocatePaymentAction).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Deallocate invoice" }));

    await waitFor(() =>
      expect(mocks.deallocatePaymentAction).toHaveBeenCalledWith({ allocationId: "alc_1" }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("Allocation removed");
  });

  it("shows the BE refusal and does not refresh", async () => {
    mocks.deallocatePaymentAction.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" },
    });
    const user = userEvent.setup();
    renderWithIntl(<PaymentAllocationsPanel payment={withRest} canUpdate />);
    await user.click(screen.getByRole("button", { name: "Deallocate" }));
    await user.click(await screen.findByRole("button", { name: "Deallocate invoice" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
