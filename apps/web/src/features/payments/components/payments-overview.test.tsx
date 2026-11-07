import { screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enPayments from "@/i18n/messages/en/payments.json";
import type { PaymentListRowDto, PaymentsOverviewDto } from "@/lib/api/types/payments";
import { PaymentsOverview } from "./payments-overview";
import { installResizeObserver, renderWithIntl } from "./test-utils";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: "payments") =>
    createTranslator({ locale: "en", messages: { payments: enPayments }, namespace }),
}));

const overview: PaymentsOverviewDto = {
  collectedByMonth: [
    { period: "2026-08", value: "0.00" },
    { period: "2026-09", value: "1200.00" },
    { period: "2026-10", value: "350.00" },
  ],
  byMethod: [{ key: "pm_1", label: "Zelle", value: "1550.00" }],
  byAccount: [{ key: "acc_1", label: "Banesco USD", value: "1550.00" }],
  pendingVerificationCount: 2,
  unallocatedCount: 1,
  unallocatedTotalUsd: "200.00",
} as PaymentsOverviewDto;

const withCredit = [
  {
    id: "pay_1",
    code: "PAG-0001",
    client: { id: "cli_1", label: "Kairos Studio", type: "CLIENT" },
    currency: "USD",
    unallocated: "200.00",
  },
] as unknown as PaymentListRowDto[];

async function renderOverview(data: PaymentsOverviewDto = overview) {
  return renderWithIntl(await PaymentsOverview({ overview: data, withCredit, canCreate: true }));
}

beforeAll(installResizeObserver);

describe("PaymentsOverview", () => {
  it("renders the header with the view toggle, the counters and the new action", async () => {
    await renderOverview();
    expect(screen.getByRole("heading", { level: 1, name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /record payment/i })).toHaveAttribute(
      "href",
      "/payments/new",
    );
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    expect(screen.getByText("Total credit")).toBeInTheDocument();
  });

  it("lists only the months with collections, newest first, as a simple list", async () => {
    await renderOverview();
    const card = screen.getByText("Collected per month (USD)").closest("[data-slot=card]");
    expect(card).not.toBeNull();
    const rows = within(card as HTMLElement).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/October 2026/i);
    expect(rows[1]).toHaveTextContent(/September 2026/i);
    expect(screen.queryByText(/August 2026/i)).not.toBeInTheDocument();
  });

  it("compares money strings with the money helper, not Number", async () => {
    // Below the double range: Number() underflows this positive amount to 0 and would hide the month.
    await renderOverview({
      ...overview,
      collectedByMonth: [
        { period: "2026-09", value: `0.${"0".repeat(400)}1` },
        { period: "2026-10", value: "-0.00" },
      ],
    });
    const card = screen.getByText("Collected per month (USD)").closest("[data-slot=card]");
    expect(within(card as HTMLElement).queryAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the breakdowns and the payments with credit in the aside", async () => {
    await renderOverview();
    expect(screen.getByText("By method")).toBeInTheDocument();
    expect(screen.getByText("By account")).toBeInTheDocument();
    expect(screen.getByText("Payments with credit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PAG-0001/ })).toHaveAttribute(
      "href",
      "/payments/pay_1",
    );
  });
});
