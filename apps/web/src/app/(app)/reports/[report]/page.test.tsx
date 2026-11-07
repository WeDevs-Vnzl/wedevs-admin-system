import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND_TEST");
  }),
}));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { makeKpisResponse, makeReportResponse } from "@/features/reports/test-fixtures";
import { KPI_ID_VALUES, REPORT_ID_VALUES, type ReportId } from "@/lib/validators/reports";
import ReportPage from "./page";

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

const slug = (id: string) => id.toLowerCase().replaceAll("_", "-");
const props = (report: string, search: Record<string, string> = {}) => ({
  params: Promise.resolve({ report }),
  searchParams: Promise.resolve(search),
});

/** The BE answers any report slug with that report's body, and the KPI list for the KPI slugs. */
const okRoutes = (): RouteTable => ({
  "GET /api/v1/reports/kpis": { body: makeKpisResponse() },
  "GET /api/v1/reports/{slug}": (call) => {
    const id = REPORT_ID_VALUES.find((item) => slug(item) === call.path.split("/").at(-1));
    return { body: makeReportResponse(id as ReportId) };
  },
});

beforeEach(() => {
  server.api = null;
});

describe("/reports/[report] page", () => {
  it.each(REPORT_ID_VALUES)("opens the report %s from its slug through the BE", async (id) => {
    const calls = serve(okRoutes());
    const element = await ReportPage(props(slug(id), { preset: "QUARTER" }));
    expect(element).toBeTruthy();
    expect(calls[0]!.path).toBe(`/api/v1/reports/${slug(id)}`);
    expect(calls[0]!.search.get("preset")).toBe("QUARTER");
  });

  it.each(KPI_ID_VALUES)("opens the KPI %s from its slug, from the BE's KPI list", async (id) => {
    const calls = serve(okRoutes());
    const element = await ReportPage(props(slug(id), { preset: "QUARTER" }));
    expect(element).toBeTruthy();
    expect(calls[0]!.path).toBe("/api/v1/reports/kpis");
  });

  it("answers the in-shell notFound() for an unknown slug", async () => {
    serve(okRoutes());
    await expect(ReportPage(props("profit"))).rejects.toThrow("NOT_FOUND_TEST");
  });

  it.each(["report", "kpi"] as const)(
    "shows the forbidden state, not the data, for a %s the BE forbids to Member and Viewer",
    async (kind) => {
      serve({
        "GET /api/v1/reports/kpis": errorEnvelope("FORBIDDEN"),
        "GET /api/v1/reports/{slug}": errorEnvelope("FORBIDDEN"),
      });
      render(await ReportPage(props(kind === "report" ? "taxes-registered" : "mrr")));
      expect(screen.getByText("forbidden")).toBeInTheDocument();
    },
  );

  it("fails the page for any other BE error", async () => {
    serve({ "GET /api/v1/reports/{slug}": errorEnvelope("INTERNAL") });
    await expect(ReportPage(props("taxes-registered"))).rejects.toThrow("INTERNAL");
  });
});
