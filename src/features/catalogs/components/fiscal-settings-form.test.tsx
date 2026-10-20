import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { updateFiscalSettingsAction } from "@/features/catalogs/actions";
import { DEFAULT_FISCAL_SETTINGS } from "@/lib/validators/settings";
import { FiscalSettingsForm } from "./fiscal-settings-form";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/catalogs/actions", () => ({ updateFiscalSettingsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const currencies = [
  { code: "USD", name: "US dollar", symbol: "$", decimals: 2, active: true },
  { code: "VES", name: "Bolívar", symbol: "Bs.", decimals: 2, active: true },
];

function renderForm() {
  return renderWithIntl(
    <FiscalSettingsForm
      initial={DEFAULT_FISCAL_SETTINGS}
      currencies={currencies}
      igtfMethods={["Zelle"]}
    />,
  );
}

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("FiscalSettingsForm", () => {
  it("shows the allowed VAT rates and the methods that propose IGTF", () => {
    renderForm();
    const rates = within(screen.getByRole("group", { name: "VAT" })).getAllByRole("list")[0]!;
    for (const rate of DEFAULT_FISCAL_SETTINGS.ivaRates) {
      expect(within(rates).getByText(`${rate}%`)).toBeInTheDocument();
    }
    expect(screen.getByText("Zelle")).toBeInTheDocument();
  });

  it("adds a VAT rate, marks an IGTF currency and saves every fiscal parameter", async () => {
    vi.mocked(updateFiscalSettingsAction).mockImplementation(
      async (input) => ({ ok: true, data: input }) as never,
    );
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("New rate (%)"), "12");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByLabelText("USD · US dollar"));
    const dueDays = screen.getByLabelText("Default due days");
    await user.clear(dueDays);
    await user.type(dueDays, "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateFiscalSettingsAction).toHaveBeenCalledWith({
        ...DEFAULT_FISCAL_SETTINGS,
        ivaRates: [...DEFAULT_FISCAL_SETTINGS.ivaRates, "12"],
        igtfCurrencies: ["USD"],
        invoiceDefaultDueDays: 30,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Fiscal settings saved");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("rejects a repeated VAT rate", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("New rate (%)"), DEFAULT_FISCAL_SETTINGS.ivaRates[0]!);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("The VAT rate is repeated")).toBeInTheDocument();
  });

  it("blocks saving when the default rate is removed from the allowed rates", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(
      screen.getByRole("button", { name: `Remove ${DEFAULT_FISCAL_SETTINGS.ivaDefaultRate}%` }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("The default VAT rate must be one of the allowed rates"),
    ).toBeInTheDocument();
    expect(updateFiscalSettingsAction).not.toHaveBeenCalled();
  });
});
