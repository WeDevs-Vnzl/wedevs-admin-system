import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrencyDTO } from "@/lib/validators/catalogs";
import { createCurrencyAction, updateCurrencyAction } from "@/features/catalogs/actions";
import { CurrenciesTable } from "./currencies-table";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/catalogs/actions", () => ({
  createCurrencyAction: vi.fn(),
  updateCurrencyAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const rows: CurrencyDTO[] = [
  { code: "USD", name: "US dollar", symbol: "$", decimals: 2, active: true },
  { code: "COP", name: "Colombian peso", symbol: "COL$", decimals: 2, active: false },
];

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("CurrenciesTable", () => {
  it("lists every currency with its status; USD cannot be deactivated", () => {
    renderWithIntl(<CurrenciesTable rows={rows} />);
    const cop = screen.getByRole("row", { name: /COP/ });
    expect(within(cop).getByText("Colombian peso")).toBeInTheDocument();
    expect(within(cop).getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Activate or deactivate US dollar" })).toBeDisabled();
  });

  it("creates a currency with the form values", async () => {
    vi.mocked(createCurrencyAction).mockResolvedValue({ ok: true, data: rows[0] } as never);
    const user = userEvent.setup();
    renderWithIntl(<CurrenciesTable rows={rows} />);
    await user.click(screen.getByRole("button", { name: "New currency" }));
    await user.type(screen.getByLabelText("Code"), "brl");
    await user.type(screen.getByLabelText("Name"), "Brazilian real");
    await user.type(screen.getByLabelText("Symbol"), "R$");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createCurrencyAction).toHaveBeenCalledWith({
        code: "BRL",
        name: "Brazilian real",
        symbol: "R$",
        decimals: 2,
        active: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Currency created");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows a service conflict on the code field and keeps the dialog open", async () => {
    vi.mocked(createCurrencyAction).mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: { code: ["catalogs.currencies.errors.codeTaken"] },
      },
    } as never);
    const user = userEvent.setup();
    renderWithIntl(<CurrenciesTable rows={rows} />);
    await user.click(screen.getByRole("button", { name: "New currency" }));
    await user.type(screen.getByLabelText("Code"), "USD");
    await user.type(screen.getByLabelText("Name"), "Dup");
    await user.type(screen.getByLabelText("Symbol"), "$");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("A currency with that code already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.toast.error).toHaveBeenCalled();
  });

  it("edits a currency keeping its code read-only", async () => {
    vi.mocked(updateCurrencyAction).mockResolvedValue({ ok: true, data: rows[1] } as never);
    const user = userEvent.setup();
    renderWithIntl(<CurrenciesTable rows={rows} />);
    await user.click(screen.getByRole("button", { name: "Edit Colombian peso" }));
    expect(screen.getByLabelText("Code")).toHaveAttribute("readonly");
    const decimals = screen.getByLabelText("Decimals");
    await user.clear(decimals);
    await user.type(decimals, "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateCurrencyAction).toHaveBeenCalledWith({
        code: "COP",
        name: "Colombian peso",
        symbol: "COL$",
        decimals: 0,
        active: false,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Currency updated");
  });

  it("activates a currency from its switch", async () => {
    vi.mocked(updateCurrencyAction).mockResolvedValue({ ok: true, data: rows[1] } as never);
    const user = userEvent.setup();
    renderWithIntl(<CurrenciesTable rows={rows} />);
    await user.click(screen.getByRole("switch", { name: "Activate or deactivate Colombian peso" }));
    await waitFor(() =>
      expect(updateCurrencyAction).toHaveBeenCalledWith({ ...rows[1], active: true }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Currency activated");
  });
});
