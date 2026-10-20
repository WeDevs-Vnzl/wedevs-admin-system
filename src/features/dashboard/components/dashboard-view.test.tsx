import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esDashboard from "@/i18n/messages/es/dashboard.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { DASHBOARD_KPI_ID_VALUES, type DashboardDTO } from "@/lib/validators/dashboard";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
}));
vi.mock("@/features/alerts/components/alert-list", () => ({
  AlertList: ({ variant }: { variant?: string }) => (
    <div data-testid="alert-list">{variant ?? "full"}</div>
  ),
}));

import { DashboardView, type DashboardViewProps } from "./dashboard-view";

const ref = (type: string, id: string, label: string, code?: string) =>
  ({
    type,
    id,
    label,
    ...(code ? { code } : {}),
  }) as DashboardDTO["invoicesDue"][number]["invoice"];

const KPI_VALUES: Record<(typeof DASHBOARD_KPI_ID_VALUES)[number], [string, string | null]> = {
  COLLECTED_MONTH: ["12480.00", "10576.27"],
  BILLED_MONTH: ["8920.00", "9000.00"],
  RECEIVABLE: ["3210.40", "3000.00"],
  EXPENSES_MONTH: ["2100.00", "2100.00"],
  RESULT_MONTH: ["10380.00", "8476.27"],
  ACCOUNTS_BALANCE: ["41736.20", null],
  MRR: ["4600.00", "4600.00"],
  ACTIVE_PROJECTS: ["7", null],
};

function makeDashboard(): DashboardDTO {
  const kpis = DASHBOARD_KPI_ID_VALUES.map((id) => {
    const [value, previousValue] = KPI_VALUES[id];
    return {
      id,
      unit: id === "ACTIVE_PROJECTS" ? ("COUNT" as const) : ("USD" as const),
      value,
      previousValue,
      changePercent:
        id === "COLLECTED_MONTH"
          ? "18.00"
          : id === "BILLED_MONTH"
            ? "-0.89"
            : previousValue && "0.00",
      secondaryValue: id === "RECEIVABLE" ? "2150.00" : null,
    };
  });
  return {
    month: "2026-10",
    currency: "USD",
    kpis,
    incomeVsExpenses: {
      periods: ["2026-09", "2026-10"],
      series: [
        { id: "income", values: ["14320.00", "12480.00"] },
        { id: "expenses", values: ["3000.00", "2100.00"] },
      ],
    },
    invoicesDue: [
      {
        invoice: ref("INVOICE", "inv_42", "FAC-0042", "FAC-0042"),
        client: ref("CLIENT", "cli_kairos", "Kairos Studio LLC", "CLI-0001"),
        dueDate: "2026-09-26",
        currency: "USD",
        balance: "1350.00",
        balanceUsd: "1350.00",
        daysUntilDue: -12,
      },
    ],
    installmentsToInvoice: [
      {
        installment: ref("INSTALLMENT", "ins_2", "Hito 2"),
        project: ref("PROJECT", "pry_app", "App Delivery Kairos", "PRY-0003"),
        amount: "3000.00",
        currency: "USD",
        dueDate: "2026-10-30",
      },
    ],
    documentsExpiring: [
      {
        document: ref("DOCUMENT", "doc_nda", "NDA Kairos", "DOC-0018"),
        expiresAt: "2026-10-30",
        daysLeft: 22,
      },
    ],
    upcomingRecurringExpenses: [
      {
        expense: ref("RECURRING_EXPENSE", "rex_hosting", "Hosting Vercel"),
        dueDate: "2026-10-25",
        amount: "20.00",
        currency: "USD",
        amountUsd: "20.00",
      },
    ],
    recentActivity: [
      {
        id: "act_1",
        action: "VERSION_PUBLISH",
        entity: ref("DOCUMENT", "doc_nda", "NDA Kairos", "DOC-0018"),
        actorName: "Andrés Molina",
        createdAt: "2026-10-08T15:00:00.000Z",
      },
    ],
  } as DashboardDTO;
}

function renderView(overrides: Partial<DashboardViewProps> = {}) {
  const dashboard = makeDashboard();
  const props: DashboardViewProps = {
    dashboard,
    kpis: dashboard.kpis,
    period: "month",
    showFinancials: true,
    userName: "Andrés",
    dayPart: "afternoon",
    today: "2026-10-08",
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{ common: esCommon, dashboard: esDashboard, enums: esEnums, patterns: esPatterns }}
    >
      {children}
    </NextIntlClientProvider>
  );
  return render(<DashboardView {...props} />, { wrapper });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  router.replace.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardView", () => {
  it("greets the user and shows the eight KPI cards with the previous-period comparison", () => {
    renderView();
    expect(
      screen.getByRole("heading", { level: 1, name: "Buenas tardes, Andrés" }),
    ).toBeInTheDocument();
    const cards = within(screen.getByRole("region", { name: "Indicadores" }));
    for (const label of [
      "Cobrado en el mes",
      "Facturado en el mes",
      "Cuentas por cobrar",
      "Gastos del mes",
      "Resultado del mes",
      "Saldo total en cuentas",
      "MRR",
      "Proyectos activos",
    ]) {
      expect(cards.getByText(label)).toBeInTheDocument();
    }
    expect(cards.getByText(/12\.480,00/)).toBeInTheDocument();
    expect(cards.getByText("+18 % vs. mes anterior")).toBeInTheDocument();
    expect(cards.getByText("-0,89 % vs. mes anterior")).toBeInTheDocument();
    // The receivable shows the overdue part apart.
    expect(cards.getByText(/2\.?150,00.*vencido/)).toBeInTheDocument();
    // Cards without history carry no comparison.
    expect(cards.getAllByText(/vs\. mes anterior/)).toHaveLength(6);
  });

  it("hides the financial cards, the chart and the financial panels without canSeeFinancials", () => {
    renderView({ showFinancials: false });
    const cards = within(screen.getByRole("region", { name: "Indicadores" }));
    expect(cards.getByText("Proyectos activos")).toBeInTheDocument();
    expect(cards.queryByText("Cobrado en el mes")).not.toBeInTheDocument();
    expect(cards.queryByText("Saldo total en cuentas")).not.toBeInTheDocument();
    expect(cards.queryByText("MRR")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingresos frente a gastos/)).not.toBeInTheDocument();
    expect(screen.queryByText("Facturas vencidas y por vencer (top 5)")).not.toBeInTheDocument();
    expect(screen.queryByText("Cuotas por facturar (próximos 30 días)")).not.toBeInTheDocument();
    expect(screen.queryByText("Gastos recurrentes próximos")).not.toBeInTheDocument();
    expect(screen.getByText("Documentos por vencer (próximos 30 días)")).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente (últimos 15 eventos)")).toBeInTheDocument();
  });

  it("draws the 12-month income vs expenses bar chart with a collapsible data table and CSV export", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:csv";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderView();

    const chart = within(
      screen.getByRole("region", { name: "Ingresos frente a gastos de los últimos 12 meses" }),
    );
    expect(chart.getByText(/MRR/)).toBeInTheDocument();
    expect(chart.queryByRole("table")).not.toBeInTheDocument();

    await user.click(chart.getByRole("button", { name: "Ver datos" }));
    const table = chart.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText(/14\.320,00/)).toBeInTheDocument();

    await user.click(chart.getByRole("button", { name: "Exportar CSV" }));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(await blob.text()).toBe(
      "Mes,Ingresos,Gastos\n2026-09,14320.00,3000.00\n2026-10,12480.00,2100.00\n",
    );
  });

  it("lists the overdue and soon-due invoices", () => {
    renderView();
    const panel = within(
      screen.getByRole("region", { name: "Facturas vencidas y por vencer (top 5)" }),
    );
    expect(panel.getByRole("link", { name: /FAC-0042/ })).toHaveAttribute(
      "href",
      "/invoices/inv_42",
    );
    expect(panel.getByText("Kairos Studio LLC")).toBeInTheDocument();
    expect(panel.getByText("Vencida hace 12 días")).toBeInTheDocument();
    expect(panel.getByText(/1\.?350,00/)).toBeInTheDocument();
  });

  it("lists the installments to invoice in the next 30 days", () => {
    renderView();
    const panel = within(
      screen.getByRole("region", { name: "Cuotas por facturar (próximos 30 días)" }),
    );
    expect(panel.getByText("Hito 2")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: /App Delivery Kairos/ })).toHaveAttribute(
      "href",
      "/projects/pry_app",
    );
    expect(panel.getByText(/3\.?000,00/)).toBeInTheDocument();
  });

  it("lists the documents expiring in the next 30 days", () => {
    renderView();
    const panel = within(
      screen.getByRole("region", { name: "Documentos por vencer (próximos 30 días)" }),
    );
    expect(panel.getByRole("link", { name: /NDA Kairos/ })).toHaveAttribute(
      "href",
      "/documents/doc_nda",
    );
    expect(panel.getByText("Vence en 22 días")).toBeInTheDocument();
  });

  it("lists the upcoming recurring expenses", () => {
    renderView();
    const panel = within(screen.getByRole("region", { name: "Gastos recurrentes próximos" }));
    expect(panel.getByText("Hosting Vercel")).toBeInTheDocument();
    expect(panel.getByText(/20,00/)).toBeInTheDocument();
  });

  it("shows the recent activity", () => {
    renderView();
    const panel = within(
      screen.getByRole("region", { name: "Actividad reciente (últimos 15 eventos)" }),
    );
    expect(panel.getByText("Andrés Molina")).toBeInTheDocument();
    expect(panel.getByText(/Publicó versión/)).toBeInTheDocument();
    expect(panel.getByRole("link", { name: /DOC-0018/ })).toHaveAttribute(
      "href",
      "/documents/doc_nda",
    );
  });

  it("switches the period with the Mes / Trimestre / Año selector and labels the cards for it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderView();
    const selector = within(screen.getByRole("radiogroup", { name: "Periodo" }));
    expect(selector.getByRole("radio", { name: "Mes" })).toHaveAttribute("aria-checked", "true");

    await user.click(selector.getByRole("radio", { name: "Trimestre" }));
    expect(router.replace).toHaveBeenCalledWith("/dashboard?period=quarter", { scroll: false });
    await user.click(selector.getByRole("radio", { name: "Año" }));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard?period=year", { scroll: false });
    unmount();

    renderView({ period: "quarter" });
    const cards = within(screen.getByRole("region", { name: "Indicadores" }));
    expect(cards.getByText("Cobrado en el trimestre")).toBeInTheDocument();
    expect(cards.getByText("+18 % vs. trimestre anterior")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Mes" }));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard", { scroll: false });
  });

  it("renders the shared AlertList", () => {
    renderView({ showFinancials: false });
    const aside = within(screen.getByRole("region", { name: "Alertas" }));
    expect(aside.getByTestId("alert-list")).toHaveTextContent("full");
  });
});
