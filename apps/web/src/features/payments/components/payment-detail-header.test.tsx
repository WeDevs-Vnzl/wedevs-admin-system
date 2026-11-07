import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentDetailHeader } from "./payment-detail-header";
import { renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({
  setPaymentStatusAction: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/payments/actions", () => ({
  setPaymentStatusAction: mocks.setPaymentStatusAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const payment = {
  id: "pag_1",
  code: "PAG-0001",
  status: "CONFIRMADO" as const,
  description: "Kairos Studio · Transferencia",
};
const pending = { ...payment, status: "PENDIENTE_VERIFICACION" as const };

beforeEach(() => {
  for (const mock of [
    mocks.setPaymentStatusAction,
    mocks.refresh,
    mocks.toast.success,
    mocks.toast.error,
  ]) {
    mock.mockReset();
  }
});

describe("PaymentDetailHeader", () => {
  it("shows the payment code, the client and method line and the status", () => {
    renderWithIntl(<PaymentDetailHeader payment={payment} />);

    expect(screen.getByRole("heading", { level: 1, name: "PAG-0001" })).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio · Transferencia")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it('offers the shared "Detail | Graph" toggle on Detail (A4)', () => {
    renderWithIntl(<PaymentDetailHeader payment={payment} />);

    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("Detail").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Graph").closest("a")).toHaveAttribute("href", "/payments/pag_1/graph");
  });
});

describe("PaymentDetailHeader status actions (DT-213)", () => {
  it("offers Confirm, Edit and Void on a pending payment for a role that may update", () => {
    renderWithIntl(<PaymentDetailHeader payment={pending} canUpdate />);
    expect(screen.getByRole("button", { name: "Confirm payment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/payments/pag_1/edit",
    );
    expect(screen.getByRole("button", { name: "Void payment" })).toBeInTheDocument();
  });

  it("offers only Edit and Void on a confirmed payment", () => {
    renderWithIntl(<PaymentDetailHeader payment={payment} canUpdate />);
    expect(screen.queryByRole("button", { name: "Confirm payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void payment" })).toBeInTheDocument();
  });

  it("offers nothing on a voided payment", () => {
    renderWithIntl(<PaymentDetailHeader payment={{ ...payment, status: "ANULADO" }} canUpdate />);
    expect(screen.queryByRole("button", { name: /payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("offers nothing to a role that may not update (cosmetic: the BE decides)", () => {
    renderWithIntl(<PaymentDetailHeader payment={pending} />);
    expect(screen.queryByRole("button", { name: "Confirm payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("confirms through the status action and refreshes the page", async () => {
    mocks.setPaymentStatusAction.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    renderWithIntl(<PaymentDetailHeader payment={pending} canUpdate />);
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    await waitFor(() =>
      expect(mocks.setPaymentStatusAction).toHaveBeenCalledWith({
        id: "pag_1",
        status: "CONFIRMADO",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("Payment confirmed");
  });

  it("shows the mapped 422 when confirming goes over the limits", async () => {
    mocks.setPaymentStatusAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { allocations: ["payments.validation.allocationsExceedAllocatable"] },
      },
    });
    const user = userEvent.setup();
    renderWithIntl(<PaymentDetailHeader payment={pending} canUpdate />);
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "The allocations exceed the allocatable amount",
      ),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("voids only with a reason and sends it", async () => {
    mocks.setPaymentStatusAction.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    renderWithIntl(<PaymentDetailHeader payment={payment} canUpdate />);
    await user.click(screen.getByRole("button", { name: "Void payment" }));

    const confirm = await screen.findByRole("button", { name: "Void" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Reason"), "Duplicated deposit");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(mocks.setPaymentStatusAction).toHaveBeenCalledWith({
        id: "pag_1",
        status: "ANULADO",
        reason: "Duplicated deposit",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("Payment voided");
  });
});
