import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enAccounts from "@/i18n/messages/en/accounts.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import type { AccountLedgerEntryDto } from "@/lib/api/types/accounts";

import { AccountLedgerTable } from "./account-ledger-table";

const rows: AccountLedgerEntryDto[] = [
  {
    id: "led_1",
    date: "2026-01-01",
    kind: "OPENING_BALANCE",
    source: null,
    description: null,
    amount: "1000.00",
    balance: "1000.00",
  },
  {
    id: "led_2",
    date: "2026-02-01",
    kind: "TRANSFER_OUT",
    source: { id: "trf_1", type: "TRANSFER", label: "Transfer to Caja", code: null },
    description: null,
    amount: "-250.25",
    balance: "749.75",
  },
  {
    id: "led_3",
    date: "2026-03-01",
    kind: "AJUSTE",
    source: null,
    description: "Bank fee",
    amount: "-9.75",
    balance: "740.00",
  },
];

describe("AccountLedgerTable (HU-15 CA2)", () => {
  it("shows the amount and the running balance exactly as the BE returned them", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="America/Caracas"
        messages={{
          accounts: enAccounts,
          common: enCommon,
          enums: enEnums,
          patterns: enPatterns,
          table: enTable,
        }}
      >
        <AccountLedgerTable rows={rows} currency="USD" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Opening balance")).toBeInTheDocument();
    expect(screen.getByText("Transfer sent")).toBeInTheDocument();
    expect(screen.getByText("Transfer to Caja")).toBeInTheDocument();
    expect(screen.getByText("Bank fee")).toBeInTheDocument();
    // The running balances are rendered from the response, never recomputed from the amounts.
    expect(screen.getAllByText(/749\.75/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/740\.00/).length).toBeGreaterThan(0);
  });
});
