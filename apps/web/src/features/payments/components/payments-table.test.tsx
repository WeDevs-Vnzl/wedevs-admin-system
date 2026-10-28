import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentListRow } from "@/lib/validators/payments";
import { listPaymentsAction } from "../actions";
import { PaymentsTable } from "./payments-table";
import { installResizeObserver, renderWithIntl } from "./test-utils";

vi.mock("../actions", () => ({ listPaymentsAction: vi.fn() }));
vi.mock("@/features/clients/actions", () => ({ searchClientsAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = {
  id: "pay_1",
  code: "PAG-0001",
  date: "2026-10-01",
  client: { id: "cli_1", label: "Kairos Studio", type: "CLIENT" },
  method: { id: "pm_1", code: "ZELLE", name: "Zelle", nameEn: null },
  account: { id: "acc_1", label: "Banesco USD", type: "ACCOUNT" },
  currency: "USD",
  amount: "500.00",
  amountUsd: "500.00",
  allocated: "300.00",
  unallocated: "200.00",
  reference: "REF-1",
  status: "CONFIRMADO",
} as unknown as PaymentListRow;

const facetSources = {
  accounts: [{ id: "acc_1", name: "Banesco USD" }],
  methods: [{ id: "pm_1", name: "Zelle", nameEn: null }],
  currencies: [{ code: "USD", name: "Dólar" }],
};

function renderTable() {
  return renderWithIntl(
    <NuqsTestingAdapter>
      <PaymentsTable initialRows={[row]} initialTotal={1} facetSources={facetSources} canCreate />
    </NuqsTestingAdapter>,
  );
}

beforeAll(installResizeObserver);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPaymentsAction).mockResolvedValue({
    ok: true,
    data: { items: [row], total: 1, page: 1, pageSize: 25, pageCount: 1 },
  } as never);
});

describe("PaymentsTable", () => {
  it("shows the server page with its facets and search, without reloading", () => {
    renderTable();
    expect(screen.getByText("PAG-0001")).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search by code, client, reference or account"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sort by Status" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /currency/i }).length).toBeGreaterThan(0);
    expect(listPaymentsAction).not.toHaveBeenCalled();
  });

  it("reloads through the action with the header sort", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Sort by Code" }));
    await waitFor(() =>
      expect(listPaymentsAction).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "code:asc" }),
      ),
    );
  });
});
