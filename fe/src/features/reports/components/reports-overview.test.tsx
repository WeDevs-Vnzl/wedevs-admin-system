import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import esReports from "@/i18n/messages/es/reports.json";
import { actionOk } from "@/lib/validators/common";
import {
  KPI_ID_VALUES,
  REPORT_ID_VALUES,
  reportFilterSchema,
  type KpiResultDTO,
  type ReportFilter,
} from "@/lib/validators/reports";
import type { MockServiceContext } from "@/mocks/ctx";
import { getKpi } from "@/mocks/services/reports";
import { makeTestContext } from "@/mocks/test-helpers";
import { parseReportSlug } from "../report-catalog";
import { ReportsOverview } from "./reports-overview";
import { installResizeObserver, renderWithIntl } from "./test-utils";

// `/reports` (PRD §8.13, HU-31 CA2) over the mock reports service.

let ctx: MockServiceContext;
const kpisSpy = vi.fn();
vi.mock("@/features/reports/actions", () => ({
  getReportAction: vi.fn(),
  getKpiAction: vi.fn(),
  getKpisAction: async ({ filter }: { filter: ReportFilter }) => {
    kpisSpy(filter);
    return actionOk(await loadKpis(reportFilterSchema.parse(filter)));
  },
}));

function loadKpis(filter: ReportFilter): Promise<KpiResultDTO[]> {
  return Promise.all(KPI_ID_VALUES.map((id) => getKpi(ctx, { id, filter })));
}

const LAST_12 = reportFilterSchema.parse({ preset: "LAST_12_MONTHS" });

async function renderOverview() {
  const kpis = await loadKpis(LAST_12);
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
  ctx = makeTestContext("OWNER").ctx;
  kpisSpy.mockReset();
});

describe("ReportsOverview", () => {
  it("lists the ten reports of §8.13.1, each linking to a page that resolves to it", async () => {
    await renderOverview();
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

  it("shows one card per KPI with its value, the change vs the previous period and a 12-month sparkline", async () => {
    const kpis = await renderOverview();
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
    const mrr = kpis.find((kpi) => kpi.id === "MRR")!;
    expect(mrr.sparkline.length).toBeGreaterThan(0);
    expect(mrr.sparkline.length).toBeLessThanOrEqual(12);
  });

  it("opens the detailed report of a card, keeping the range", async () => {
    await renderOverview();
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

  it("updates every card and sparkline when the date range changes (HU-31 CA2)", async () => {
    const user = userEvent.setup();
    const before = await renderOverview();
    const after = await loadKpis(reportFilterSchema.parse({ preset: "PREVIOUS_MONTH" }));
    const periods = (kpis: KpiResultDTO[]) =>
      kpis.map((kpi) => kpi.sparkline.map((point) => point.period));
    // The fixture must make the change observable on the cards.
    expect(periods(after)).not.toEqual(periods(before));

    await user.click(screen.getByRole("radio", { name: esReports.filters.presets.PREVIOUS_MONTH }));

    expect(kpisSpy).toHaveBeenCalledWith(expect.objectContaining({ preset: "PREVIOUS_MONTH" }));
    await waitFor(() =>
      expect(
        kpiCards().map((card) => sparklinePoints(card).map((text) => text?.slice(0, 7))),
      ).toEqual(periods(after)),
    );
    kpiCards().forEach((card, index) => {
      const kpi = after[index]!;
      expect(card).toHaveTextContent(
        kpi.changePercent === null ? esReports.kpi.noPrevious : "frente al periodo anterior",
      );
      if (kpi.value === null) expect(card).toHaveTextContent(esReports.kpi.noData);
      expect(within(card).getByRole("link")).toHaveAttribute(
        "href",
        expect.stringContaining("?preset=PREVIOUS_MONTH"),
      );
    });
  });
});
