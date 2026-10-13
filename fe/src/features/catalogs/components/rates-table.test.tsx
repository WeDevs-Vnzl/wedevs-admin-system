import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  importRatesCsvAction,
  listExchangeRatesAction,
  loadDailyRatesAction,
} from "@/features/catalogs/actions";
import type { ExchangeRateDTO } from "@/lib/validators/catalogs";
import { RatesTable } from "./rates-table";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/catalogs/actions", () => ({
  listExchangeRatesAction: vi.fn(),
  loadDailyRatesAction: vi.fn(),
  importRatesCsvAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const rows: ExchangeRateDTO[] = [
  {
    id: "rate_1",
    date: "2026-10-13",
    currency: "VES",
    usdRate: "180.50",
    source: "BCV",
    createdAt: "2026-10-13T12:00:00.000Z",
    createdById: null,
  },
];
const currencies = [
  { code: "VES", name: "Bolívar", lastRate: { usdRate: "100", date: "2026-10-12" } },
  { code: "COP", name: "Colombian peso", lastRate: null },
];

function renderTable() {
  return renderWithIntl(
    <NuqsTestingAdapter>
      <RatesTable rows={rows} total={1} today="2026-10-13" currencies={currencies} />
    </NuqsTestingAdapter>,
  );
}

beforeAll(installResizeObserver);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listExchangeRatesAction).mockResolvedValue({
    ok: true,
    data: { items: rows, total: 1, page: 1, pageSize: 25, pageCount: 1 },
  } as never);
});

describe("RatesTable", () => {
  it("lists the stored rates with their source", () => {
    renderTable();
    expect(screen.getByText("180.50")).toBeInTheDocument();
    expect(screen.getAllByText("BCV").length).toBeGreaterThan(0);
  });

  it("quick load: saves only the typed currencies for the date, BCV by default", async () => {
    vi.mocked(loadDailyRatesAction).mockResolvedValue({
      ok: true,
      data: { created: 1, updated: 0 },
    } as never);
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Quick load" }));
    await user.type(screen.getByLabelText("VES rate per USD"), "101.25");
    await user.click(screen.getByRole("button", { name: "Save rates" }));
    await waitFor(() =>
      expect(loadDailyRatesAction).toHaveBeenCalledWith({
        date: "2026-10-13",
        source: "BCV",
        rates: [{ currency: "VES", usdRate: "101.25" }],
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("1 rate saved");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("quick load: warns when a rate is more than 10 % away from the last one, and asks for one rate", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Quick load" }));
    expect(screen.getByText("No previous rate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save rates" }));
    expect(screen.getByText("Type at least one rate")).toBeInTheDocument();
    expect(loadDailyRatesAction).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("VES rate per USD"), "111");
    expect(
      screen.getByText("Differs by more than 10% from the last rate. Check it before saving."),
    ).toBeInTheDocument();
  });

  it("CSV import: sends the valid rows and shows the summary with the rejected rows", async () => {
    vi.mocked(importRatesCsvAction).mockResolvedValue({
      ok: true,
      data: { created: 1, updated: 0, skipped: 0, errors: [] },
    } as never);
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Import CSV" }));
    const csv = "date,currency,usdRate,source\n2026-10-12,VES,99.5,BCV\nbad-date,VES,1,BCV\n";
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File([csv], "rates.csv", { type: "text/csv" }),
    );
    expect(await screen.findByText("1 row ready to import")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(importRatesCsvAction).toHaveBeenCalledWith({
        rows: [{ date: "2026-10-12", currency: "VES", usdRate: "99.5", source: "BCV" }],
        overwrite: false,
      }),
    );
    expect(await screen.findByText("1 created, 0 updated, 0 skipped")).toBeInTheDocument();
    expect(screen.getByText(/^Row 2:/)).toBeInTheDocument();
  });

  it("CSV import: rejects a file without the required columns", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Import CSV" }));
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["foo,bar\n1,2\n"], "rates.csv", { type: "text/csv" }),
    );
    expect(
      await screen.findByText("The file does not have the date, currency and usdRate columns."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});
