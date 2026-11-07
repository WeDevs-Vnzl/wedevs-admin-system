import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClientDetailDto, ClientSummaryResponseDto } from "@/lib/api/types/clients";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
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
} as unknown as ClientDetailDto;

const financials: ClientSummaryResponseDto = {
  clientId: "cli_kairos",
  totalInvoicedUsd: "2820.00",
  totalCollectedUsd: "800.00",
  receivableUsd: "2020.00",
  overdueUsd: "0.00",
  creditBalanceUsd: "0.00",
  collectedLast12MonthsUsd: "800.00",
  projectCount: 2,
};

describe("ClientSidePanel financial card", () => {
  it("renders the card from the summary the page read for a finance role", async () => {
    render(await ClientSidePanel({ client, financials }));
    const card = screen.getByTestId("financial-card");
    expect(card).toHaveTextContent("metrics.totalInvoiced=2820.00");
    expect(card).toHaveTextContent("metrics.totalCollected=800.00");
    expect(card).toHaveTextContent("metrics.receivable=2020.00");
  });

  it("shows no card without a summary, only the key data", async () => {
    render(await ClientSidePanel({ client, financials: null }));
    expect(screen.queryByTestId("financial-card")).toBeNull();
    expect(screen.getByText("keyData.title")).toBeInTheDocument();
  });
});
