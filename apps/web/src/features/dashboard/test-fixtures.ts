import type { DashboardResponseDto } from "@/lib/api/types/intel";

// TEST FIXTURE: synthetic `GET /api/v1/dashboard` bodies for the HTTP-mocked tests (no customer data, no mock
// service). Values are decimal strings, as the contract sends them (C15).

const MONTHS = [
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
];

export function makeDashboardResponse(
  overrides: Partial<DashboardResponseDto> = {},
): DashboardResponseDto {
  return {
    currency: "USD",
    period: "month",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    month: "2026-10",
    kpis: [
      {
        id: "COLLECTED_MONTH",
        unit: "USD",
        value: "12480.00",
        previousValue: "10576.27",
        changePercent: "18.00",
        secondaryValue: null,
      },
      {
        id: "BILLED_MONTH",
        unit: "USD",
        value: "8920.00",
        previousValue: "9000.00",
        changePercent: "-0.89",
        secondaryValue: null,
      },
      {
        id: "RECEIVABLE",
        unit: "USD",
        value: "3210.40",
        previousValue: "3000.00",
        changePercent: "7.01",
        secondaryValue: "2150.00",
      },
      {
        id: "EXPENSES_MONTH",
        unit: "USD",
        value: "2100.00",
        previousValue: "2100.00",
        changePercent: "0.00",
        secondaryValue: null,
      },
      {
        id: "RESULT_MONTH",
        unit: "USD",
        value: "10380.00",
        previousValue: "8476.27",
        changePercent: "22.45",
        secondaryValue: null,
      },
      {
        id: "ACCOUNTS_BALANCE",
        unit: "USD",
        value: "41736.20",
        previousValue: null,
        changePercent: null,
        secondaryValue: null,
      },
      {
        id: "MRR",
        unit: "USD",
        value: "4600.00",
        previousValue: "4600.00",
        changePercent: "0.00",
        secondaryValue: null,
      },
      {
        id: "ACTIVE_PROJECTS",
        unit: "COUNT",
        value: "7",
        previousValue: null,
        changePercent: null,
        secondaryValue: null,
      },
    ],
    incomeVsExpenses: {
      periods: MONTHS,
      series: [
        { id: "income", values: MONTHS.map((_, index) => String(1000 + index * 100)) },
        { id: "expenses", values: MONTHS.map((_, index) => String(500 + index * 20)) },
      ],
    },
    invoicesDue: [],
    installmentsToInvoice: [],
    documentsExpiring: [],
    upcomingRecurringExpenses: [],
    recentActivity: [],
    ...overrides,
  };
}
