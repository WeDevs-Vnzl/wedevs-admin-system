import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esReports from "@/i18n/messages/es/reports.json";
import { mockApi, type RecordedCall } from "@/lib/api/testing";
import { KPI_ID_VALUES, REPORT_ID_VALUES, reportFilterSchema } from "@/lib/validators/reports";
import { parseReportSlug } from "../report-catalog";
import { makeKpisResponse } from "../test-fixtures";
import { ReportsOverview } from "./reports-overview";
import { installResizeObserver, renderWithIntl } from "./test-utils";

// `/reports` (PRD §8.13, HU-31 CA2) with the HTTP client mocked: the KPIs come from `GET /reports/kpis`.

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

let calls: RecordedCall[];

/** The BE answers the range: the previous month ends one month earlier in the sparklines. */
function serveKpis() {
  const mock = mockApi({
    "GET /api/v1/reports/kpis": (call) => ({
      body: makeKpisResponse(
        call.search.get("preset") === "PREVIOUS_MONTH" ? "2026-09" : "2026-10",
      ),
    }),
  });
  server.api = mock.api;
  calls = mock.calls;
}

const LAST_12 = reportFilterSchema.parse({ preset: "LAST_12_MONTHS" });

function renderOverview() {
  const kpis = makeKpisResponse().kpis;
  renderWithIntl(<ReportsOverview initialKpis={kpis} initialFilter={LAST_12} />);
  return kpis;
}

/** The cards are the KPI list's own items (each card holds its sparkline list too). */
function kpiCards() {
  const list = screen.getByRole("list", { name: esReports.page.kpisTitle });
  return within(list)
    .getAllByRole("listitem")
    .filter((item) => item.parentElement === list);
}

function sparklinePoints(card: HTMLElement) {
  return within(within(card).getByRole("list", { name: esReports.kpi.sparkline }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeAll(installResizeObserver);
beforeEach(() => {
  serveKpis();
});

describe("ReportsOverview", () => {
  it("lists the ten reports of §8.13.1, each linking to a page that resolves to it", () => {
    renderOverview();
    const list = screen.getByRole("list", { name: esReports.page.reportsTitle });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(10);
    REPORT_ID_VALUES.forEach((id, index) => {
      const link = links[index]!;
      expect(link).toHaveTextContent(esReports.items.reports[id].title);
      const slug = new URL(link.getAttribute("href")!, "http://x").pathname.split("/")[2]!;
      expect(parseReportSlug(slug)).toEqual({ kind: "report", id });
    });
    expect(screen.getByText(esReports.items.reports.TAXES_REGISTERED.title)).toBeInTheDocument();
  });

  it("shows one card per KPI with its value, the change vs the previous period and a 12-month sparkline", () => {
    const kpis = renderOverview();
    const cards = kpiCards();
    expect(cards).toHaveLength(KPI_ID_VALUES.length);
    kpis.forEach((kpi, index) => {
      const card = cards[index]!;
      expect(card).toHaveTextContent(esReports.items.kpis[kpi.id].title);
      const variation =
        kpi.changePercent === null ? esReports.kpi.noPrevious : "frente al periodo anterior";
      expect(card).toHaveTextContent(variation);
      if (kpi.value === null) expect(card).toHaveTextContent(esReports.kpi.noData);
      expect(sparklinePoints(card)).toHaveLength(kpi.sparkline.length);
    });
    // A client filter gives a null figure: the card reads "no data", not a zero.
    expect(kpis.find((kpi) => kpi.id === "DSO")!.value).toBeNull();
    expect(cards[KPI_ID_VALUES.indexOf("DSO")]!).toHaveTextContent(esReports.kpi.noData);
  });

  it("opens the detailed report of a card, keeping the range", () => {
    renderOverview();
    const card = kpiCards()[KPI_ID_VALUES.indexOf("DSO")]!;
    const link = within(card).getByRole("link");
    expect(link).toHaveAttribute("href", "/reports/dso?preset=LAST_12_MONTHS");
    expect(parseReportSlug("dso")).toEqual({ kind: "kpi", id: "DSO" });
    for (const reportLink of within(
      screen.getByRole("list", { name: esReports.page.reportsTitle }),
    ).getAllByRole("link")) {
      expect(reportLink.getAttribute("href")).toMatch(/\?preset=LAST_12_MONTHS$/);
    }
  });

  it("reloads every card and sparkline from the BE when the date range changes (HU-31 CA2)", async () => {
    const user = userEvent.setup();
    renderOverview();
    const after = makeKpisResponse("2026-09").kpis;
    const periods = (kpis: typeof after) =>
      kpis.map((kpi) => kpi.sparkline.map((point) => point.period));
    // The fixture must make the change observable on the cards.
    expect(periods(after)).not.toEqual(periods(makeKpisResponse().kpis));

    await user.click(screen.getByRole("radio", { name: esReports.filters.presets.PREVIOUS_MONTH }));

    // One card is enough to see the reload land; checking all eighteen on every poll is slow in jsdom.
    const mrr = KPI_ID_VALUES.indexOf("MRR");
    await waitFor(() =>
      expect(sparklinePoints(kpiCards()[mrr]!).map((text) => text?.slice(0, 7))).toEqual(
        periods(after)[mrr],
      ),
    );
    const reloads = calls.filter((call) => call.search.get("preset") === "PREVIOUS_MONTH");
    expect(reloads).toHaveLength(1);
    expect(within(kpiCards()[mrr]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("?preset=PREVIOUS_MONTH"),
    );
  }, 30_000);
});
