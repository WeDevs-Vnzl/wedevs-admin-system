import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esReports from "@/i18n/messages/es/reports.json";
import { mockApi, type RecordedCall } from "@/lib/api/testing";
import { formatMoney } from "@/lib/money";
import { REPORT_ID_VALUES, reportFilterSchema, type ReportId } from "@/lib/validators/reports";
import { makeKpisResponse, makeReportResponse } from "../test-fixtures";
import { ReportDetail } from "./report-detail";
import { installResizeObserver, renderWithIntl } from "./test-utils";

// `/reports/[report]` (PRD §8.13.1, DT-44, HU-31 CA2) with the HTTP client mocked: the report and the KPI come from
// `GET /reports/{slug}` and `GET /reports/kpis`.

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

const slugOf = (id: string) => id.toLowerCase().replaceAll("_", "-");
let calls: RecordedCall[];

function serve() {
  const mock = mockApi({
    "GET /api/v1/reports/kpis": { body: makeKpisResponse() },
    "GET /api/v1/reports/{slug}": (call) => {
      const id = REPORT_ID_VALUES.find((item) => slugOf(item) === call.path.split("/").at(-1));
      return { body: makeReportResponse(id as ReportId) };
    },
  });
  server.api = mock.api;
  calls = mock.calls;
}

const LAST_12 = reportFilterSchema.parse({ preset: "LAST_12_MONTHS" });

function chartPoints(name: string) {
  const figure = screen.getByRole("figure", { name });
  return within(figure)
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeAll(installResizeObserver);
beforeEach(serve);

describe("ReportDetail", () => {
  it.each(REPORT_ID_VALUES)("renders the %s report with its chart and data table", async (id) => {
    const user = userEvent.setup();
    renderWithIntl(
      <ReportDetail
        page={{ kind: "report", id }}
        initial={makeReportResponse(id)}
        initialFilter={LAST_12}
      />,
    );
    const title = esReports.items.reports[id].title;
    const figure = screen.getByRole("figure", { name: title });
    expect(within(figure).getByRole("button", { name: esReports.chart.exportCsv })).toBeEnabled();
    await user.click(within(figure).getByRole("button", { name: esReports.chart.showData }));
    expect(within(figure).getByRole("table")).toBeInTheDocument();
  });

  it("shows the IVA billed per rate in Impuestos registrados (DT-44)", async () => {
    const user = userEvent.setup();
    const result = makeReportResponse("TAXES_REGISTERED");
    if (result.reportId !== "TAXES_REGISTERED") throw new Error("fixture of another report");
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

  it("shows a null margin of a client filter as no data, not as zero (DT-176)", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <ReportDetail
        page={{ kind: "report", id: "REVENUE_BY_PROJECT" }}
        initial={makeReportResponse("REVENUE_BY_PROJECT")}
        initialFilter={LAST_12}
      />,
    );
    const figure = screen.getByRole("figure", {
      name: esReports.items.reports.REVENUE_BY_PROJECT.title,
    });
    await user.click(within(figure).getByRole("button", { name: esReports.chart.showData }));
    const rows = within(within(figure).getByRole("table")).getAllByRole("row").slice(1);
    // The margin and its percentage read "—" (no data); the collected amount is still its own figure.
    expect(within(rows[1]!).getAllByText("—")).toHaveLength(2);
  });

  it("reloads the charts from the BE when the date range changes (HU-31 CA2)", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <ReportDetail
        page={{ kind: "report", id: "BILLED_VS_COLLECTED" }}
        initial={makeReportResponse("BILLED_VS_COLLECTED")}
        initialFilter={LAST_12}
      />,
    );
    const title = esReports.items.reports.BILLED_VS_COLLECTED.title;
    expect(chartPoints(title)).toHaveLength(2);

    await user.click(screen.getByRole("radio", { name: esReports.filters.presets.QUARTER }));

    await waitFor(() =>
      expect(calls.some((call) => call.search.get("preset") === "QUARTER")).toBe(true),
    );
    expect(calls.find((call) => call.search.get("preset") === "QUARTER")!.path).toBe(
      "/api/v1/reports/billed-vs-collected",
    );
    expect(screen.getByRole("figure", { name: title })).toBeInTheDocument();
  });

  it("opens a KPI with its value, change and 12-month chart", () => {
    const kpi = makeKpisResponse().kpis.find((item) => item.id === "MRR")!;
    renderWithIntl(
      <ReportDetail page={{ kind: "kpi", id: "MRR" }} initial={kpi} initialFilter={LAST_12} />,
    );
    expect(chartPoints(esReports.kpi.sparkline).map((text) => text?.slice(0, 7))).toEqual(
      kpi.sparkline.map((point) => point.period),
    );
    expect(screen.getByText(esReports.kpi.value)).toBeInTheDocument();
  });

  it("shows a KPI without data as no data under a client filter", () => {
    const kpi = makeKpisResponse().kpis.find((item) => item.id === "DSO")!;
    renderWithIntl(
      <ReportDetail page={{ kind: "kpi", id: "DSO" }} initial={kpi} initialFilter={LAST_12} />,
    );
    expect(screen.getAllByText(esReports.kpi.noData).length).toBeGreaterThan(0);
  });
});
