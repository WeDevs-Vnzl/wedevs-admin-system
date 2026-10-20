import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDetailDTO } from "@/lib/validators/clients";

const queries = vi.hoisted(() => ({ getClientFinancials: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/clients/queries", () => queries);
vi.mock("@/components/patterns/money-text", () => ({
  MoneyText: ({ amount }: { amount: string }) => <span>{amount}</span>,
}));
// The card is replaced by a probe of what the panel passes to it.
vi.mock("@/components/patterns/financial-summary-card", () => ({
  FinancialSummaryCard: ({
    rows,
    total,
  }: {
    rows: { label: string; value: React.ReactNode }[];
    total: { label: string; value: React.ReactNode };
  }) => (
    <div data-testid="financial-card">
      {rows.map((row) => (
        <p key={row.label}>
          {row.label}={row.value}
        </p>
      ))}
      <p>
        {total.label}={total.value}
      </p>
    </div>
  ),
}));

import { ClientSidePanel } from "./client-side-panel";

const client = {
  id: "cli_kairos",
  kind: "EMPRESA",
  legalName: "Kairos Studio C.A.",
  taxId: "J-1",
  country: "VE",
  address: "Caracas",
  phone: "+58",
  email: null,
  website: null,
  activatedAt: null,
} as unknown as ClientDetailDTO;

beforeEach(() => {
  queries.getClientFinancials.mockReset();
  queries.getClientFinancials.mockResolvedValue({
    clientId: "cli_kairos",
    totalInvoicedUsd: "2820.00",
    totalCollectedUsd: "800.00",
    receivableUsd: "2020.00",
    overdueUsd: "0.00",
    creditBalanceUsd: "0.00",
    projectCount: 2,
  });
});

describe("ClientSidePanel financial card", () => {
  it("reads getClientFinancials and renders the card for a finance role", async () => {
    render(await ClientSidePanel({ client, canSeeFinancials: true }));
    expect(queries.getClientFinancials).toHaveBeenCalledWith("cli_kairos");
    const card = screen.getByTestId("financial-card");
    expect(card).toHaveTextContent("metrics.totalInvoiced=2820.00");
    expect(card).toHaveTextContent("metrics.totalCollected=800.00");
    expect(card).toHaveTextContent("metrics.receivable=2020.00");
  });

  it("never calls getClientFinancials without canSeeFinancials, and shows no card", async () => {
    render(await ClientSidePanel({ client, canSeeFinancials: false }));
    expect(queries.getClientFinancials).not.toHaveBeenCalled();
    expect(screen.queryByTestId("financial-card")).toBeNull();
    expect(screen.getByText("keyData.title")).toBeInTheDocument();
  });
});
