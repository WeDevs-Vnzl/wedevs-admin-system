import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectDuplicatePaymentAction } from "@/features/payments/actions";
import { installResizeObserver, renderWithIntl } from "./test-utils";
import { PaymentForm, type PaymentFormProps } from "./payment-form";

const mocks = vi.hoisted(() => ({ push: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/payments/actions", () => ({
  createPaymentAction: vi.fn(),
  detectDuplicatePaymentAction: vi.fn(),
  listOpenInvoicesAction: vi.fn(),
}));
vi.mock("@/features/catalogs/actions", () => ({ lookupRateAction: vi.fn() }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const zelle = {
  id: "pmt_zelle",
  code: "ZELLE",
  name: "Zelle",
  nameEn: "Zelle",
  requiresReference: true,
  suggestsIgtf: true,
};

const props: PaymentFormProps = {
  clients: [{ id: "cli_kairos", name: "Kairos Studio" }],
  accounts: [{ id: "acc_zelle", name: "Zelle USD", currency: "USD" }],
  methods: [zelle],
  fiscal: { igtfRate: "3", igtfCurrencies: [] },
  today: "2026-10-09",
  initialOpenInvoices: [],
};

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("PaymentForm", () => {
  it("proposes the IGTF of the amount received when the method suggests it (DT-70)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText(/Amount received/), "100");
    await waitFor(() => expect(screen.getByLabelText("IGTF")).toHaveValue("3.00"));
  });

  it("asks for the reference when the method requires it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText(/Amount received/), "10");
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(
      await screen.findByText("The reference is required for this payment method"),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("warns about a possible duplicate without refusing the payment", async () => {
    vi.mocked(detectDuplicatePaymentAction).mockResolvedValue({
      ok: true,
      data: {
        duplicate: true,
        matches: [
          {
            payment: { id: "pag_kairos_partial", label: "PAG-0001", type: "PAYMENT" },
            date: "2026-09-25",
            amount: "300.00",
            currency: "USD",
            status: "CONFIRMADO",
          },
        ],
      },
    } as never);
    const user = userEvent.setup();
    renderWithIntl(<PaymentForm {...props} />);
    await user.type(screen.getByLabelText("Reference"), "ZL-MOCK-0001");
    expect(
      await screen.findByText("Possible duplicate", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PAG-0001/)).toBeInTheDocument();
  });
});
