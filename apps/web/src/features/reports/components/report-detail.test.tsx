import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esReports from "@/i18n/messages/es/reports.json";
import { formatMoney } from "@/lib/money";
import { actionOk } from "@/lib/validators/common";
import {
  REPORT_ID_VALUES,
  reportFilterSchema,
  type GetKpiInput,
  type GetReportInput,
  type ReportFilter,
  type TaxesRegisteredReport,
} from "@/lib/validators/reports";
import type { MockServiceContext } from "@/mocks/ctx";
import { getKpi, getReport } from "@/mocks/services/reports";
import { makeTestContext } from "@/mocks/test-helpers";
import { ReportDetail } from "./report-detail";
import { installResizeObserver, renderWithIntl } from "./test-utils";

// `/reports/[report]` (PRD §8.13.1, DT-44, HU-31 CA2) over the mock reports service.

let ctx: MockServiceContext;
const reportSpy = vi.fn();
vi.mock("@/features/reports/actions", () => ({
  getKpisAction: vi.fn(),
  getReportAction: async (input: GetReportInput) => {
    reportSpy(input);
    return actionOk(
      await getReport(ctx, { ...input, filter: reportFilterSchema.parse(input.filter) }),
    );
  },
  getKpiAction: async (input: GetKpiInput) =>
    actionOk(await getKpi(ctx, { ...input, filter: reportFilterSchema.parse(input.filter) })),
}));

const LAST_12 = reportFilterSchema.parse({ preset: "LAST_12_MONTHS" });

function chartPoints(name: string) {
  const figure = screen.getByRole("figure", { name });
  return within(figure)
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeAll(installResizeObserver);
beforeEach(() => {
  ctx = makeTestContext("OWNER").ctx;
  reportSpy.mockReset();
});

describe("ReportDetail", () => {
  it.each(REPORT_ID_VALUES)("renders the %s report with its chart and data table", async (id) => {
    const user = userEvent.setup();
    const result = await getReport(ctx, { id, filter: LAST_12 });
    renderWithIntl(
      <ReportDetail page={{ kind: "report", id }} initial={result} initialFilter={LAST_12} />,
    );
    const title = esReports.items.reports[id].title;
    const figure = screen.getByRole("figure", { name: title });
    expect(within(figure).getByRole("button", { name: esReports.chart.exportCsv })).toBeEnabled();
    await user.click(within(figure).getByRole("button", { name: esReports.chart.showData }));
    expect(within(figure).getByRole("table")).toBeInTheDocument();
  });

  it("shows the IVA billed per rate in Impuestos registrados (DT-44)", async () => {
    const user = userEvent.setup();
    const result = (await getReport(ctx, {
      id: "TAXES_REGISTERED",
      filter: LAST_12,
    })) as TaxesRegisteredReport;
    expect(result.totals.ivaByRate.length).toBeGreaterThan(0);
    renderWithIntl(
      <ReportDetail
        page={{ kind: "report", id: "TAXES_REGISTERED" }}
        initial={result}
        initialFilter={LAST_12}
      />,
    );
    const figure = screen.getByRole("figure", { name: esReports.taxes.byRate });
    await user.click(within(figure).getByRole("button", { name: esReports.chart.showData }));
    const rows = within(within(figure).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(result.totals.ivaByRate.length);
    result.totals.ivaByRate.forEach((rate, index) => {
      const label = `IVA ${new Intl.NumberFormat("es").format(Number(rate.ivaRate))} %`;
      expect(rows[index]).toHaveTextContent(label);
      // Intl separates the currency with a no-break space; the matcher normalizes only the element side.
      const usd = (amount: string) => formatMoney(amount, "USD", "es").replace(/\s/g, " ");
      expect(rows[index]).toHaveTextContent(usd(rate.taxBase));
      expect(rows[index]).toHaveTextContent(usd(rate.ivaAmount));
    });
  });

  it("updates the charts when the date range changes (HU-31 CA2)", async () => {
    const user = userEvent.setup();
    const before = await getReport(ctx, { id: "BILLED_VS_COLLECTED", filter: LAST_12 });
    renderWithIntl(
      <ReportDetail
        page={{ kind: "report", id: "BILLED_VS_COLLECTED" }}
        initial={before}
        initialFilter={LAST_12}
      />,
    );
    const title = esReports.items.reports.BILLED_VS_COLLECTED.title;
    expect(chartPoints(title)).toHaveLength(12);

    const filter: ReportFilter = reportFilterSchema.parse({ preset: "QUARTER" });
    const after = await getReport(ctx, { id: "BILLED_VS_COLLECTED", filter });
    await user.click(screen.getByRole("radio", { name: esReports.filters.presets.QUARTER }));

    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "BILLED_VS_COLLECTED",
        filter: expect.objectContaining({ preset: "QUARTER" }),
      }),
    );
    const periods = after.reportId === "BILLED_VS_COLLECTED" ? after.chart.periods : [];
    await waitFor(() =>
      expect(chartPoints(title).map((text) => text?.slice(0, 7))).toEqual(periods),
    );
  });

  it("opens a KPI with its value, change and 12-month chart", async () => {
    const kpi = await getKpi(ctx, { id: "MRR", filter: LAST_12 });
    renderWithIntl(
      <ReportDetail page={{ kind: "kpi", id: "MRR" }} initial={kpi} initialFilter={LAST_12} />,
    );
    expect(chartPoints(esReports.kpi.sparkline).map((text) => text?.slice(0, 7))).toEqual(
      kpi.sparkline.map((point) => point.period),
    );
    expect(screen.getByText(esReports.kpi.value)).toBeInTheDocument();
  });
});
