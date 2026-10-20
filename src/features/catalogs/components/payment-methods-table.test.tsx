import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentMethodDTO } from "@/lib/validators/catalogs";
import { createPaymentMethodAction, updatePaymentMethodAction } from "@/features/catalogs/actions";
import { PaymentMethodsTable } from "./payment-methods-table";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/catalogs/actions", () => ({
  createPaymentMethodAction: vi.fn(),
  updatePaymentMethodAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const zelle: PaymentMethodDTO = {
  id: "pmt_zelle",
  code: "ZELLE",
  name: "Zelle",
  nameEn: null,
  requiresReference: true,
  suggestsIgtf: true,
  active: true,
};
const cash: PaymentMethodDTO = {
  id: "pmt_efectivo_ves",
  code: "EFECTIVO_VES",
  name: "Efectivo VES",
  nameEn: "Cash VES",
  requiresReference: false,
  suggestsIgtf: false,
  active: true,
};

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("PaymentMethodsTable", () => {
  it("shows the reference and IGTF flags of each method (DT-70)", () => {
    renderWithIntl(<PaymentMethodsTable rows={[zelle, cash]} />);
    const row = screen.getByRole("row", { name: /ZELLE/ });
    expect(within(row).getAllByText("Yes")).toHaveLength(2);
    // English names fall back to the Spanish one.
    expect(screen.getByText("Cash VES")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /EFECTIVO_VES/ })).getAllByText("No"),
    ).toHaveLength(2);
  });

  it("creates a method with an upper-case code and the IGTF flag", async () => {
    vi.mocked(createPaymentMethodAction).mockResolvedValue({ ok: true, data: zelle } as never);
    const user = userEvent.setup();
    renderWithIntl(<PaymentMethodsTable rows={[zelle]} />);
    await user.click(screen.getByRole("button", { name: "New method" }));
    await user.type(screen.getByLabelText("Code"), "binance_pay");
    await user.type(screen.getByLabelText("Name"), "Binance Pay");
    await user.click(screen.getByRole("switch", { name: "Proposes IGTF" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createPaymentMethodAction).toHaveBeenCalledWith({
        code: "BINANCE_PAY",
        name: "Binance Pay",
        nameEn: undefined,
        requiresReference: true,
        suggestsIgtf: true,
        active: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Payment method created");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows a name conflict on the name field", async () => {
    vi.mocked(createPaymentMethodAction).mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: { name: ["catalogs.paymentMethods.errors.nameTaken"] },
      },
    } as never);
    const user = userEvent.setup();
    renderWithIntl(<PaymentMethodsTable rows={[zelle]} />);
    await user.click(screen.getByRole("button", { name: "New method" }));
    await user.type(screen.getByLabelText("Code"), "ZELLE_2");
    await user.type(screen.getByLabelText("Name"), "zelle");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("A method with that name already exists")).toBeInTheDocument();
  });

  it("edits a method by id and deactivates one from its switch", async () => {
    vi.mocked(updatePaymentMethodAction).mockResolvedValue({ ok: true, data: cash } as never);
    const user = userEvent.setup();
    renderWithIntl(<PaymentMethodsTable rows={[zelle, cash]} />);
    await user.click(screen.getByRole("button", { name: "Edit Cash VES" }));
    expect(screen.getByLabelText("Code")).toHaveAttribute("readonly");
    await user.click(screen.getByRole("switch", { name: "Requires reference" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updatePaymentMethodAction).toHaveBeenCalledWith({
        id: "pmt_efectivo_ves",
        name: "Efectivo VES",
        nameEn: "Cash VES",
        requiresReference: true,
        suggestsIgtf: false,
        active: true,
      }),
    );

    await user.click(screen.getByRole("switch", { name: "Activate or deactivate Zelle" }));
    await waitFor(() =>
      expect(updatePaymentMethodAction).toHaveBeenLastCalledWith({
        id: "pmt_zelle",
        name: "Zelle",
        nameEn: undefined,
        requiresReference: true,
        suggestsIgtf: true,
        active: false,
      }),
    );
    expect(mocks.toast.success).toHaveBeenLastCalledWith("Payment method deactivated");
  });
});
