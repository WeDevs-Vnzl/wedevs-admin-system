import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { reportFilterSchema } from "@/lib/validators/reports";
import { getKpiCards, getKpiDetail, getReportDetail } from "./queries";
import { makeKpisResponse, makeReportResponse } from "./test-fixtures";

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

beforeEach(() => {
  server.api = null;
});

describe("getKpiCards", () => {
  it("reads the eighteen KPIs of the range in one call, with the filter as the query", async () => {
    const body = makeKpisResponse();
    const calls = serve({ "GET /api/v1/reports/kpis": { body } });
    const filter = reportFilterSchema.parse({
      preset: "CUSTOM",
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
    });

    const result = await getKpiCards(filter);

    expect(result).toEqual({ ok: true, data: body });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.search.get("preset")).toBe("CUSTOM");
    expect(calls[0]!.search.get("from")).toBe("2026-01-01");
    expect(calls[0]!.search.get("to")).toBe("2026-03-31");
  });

  it("answers the FORBIDDEN error for Member and Viewer, so the page shows the forbidden state", async () => {
    serve({ "GET /api/v1/reports/kpis": errorEnvelope("FORBIDDEN") });

    const result = await getKpiCards(reportFilterSchema.parse({}));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "common.errors.FORBIDDEN",
        correlationId: "test-correlation-id",
      },
    });
  });
});

describe("getReportDetail", () => {
  it("reads one report by its kebab-case slug, over the range", async () => {
    const body = makeReportResponse("REVENUE_BY_PROJECT");
    const calls = serve({ "GET /api/v1/reports/{slug}": { body } });

    const result = await getReportDetail(
      "REVENUE_BY_PROJECT",
      reportFilterSchema.parse({ preset: "QUARTER" }),
    );

    expect(result).toEqual({ ok: true, data: body });
    expect(calls[0]!.path).toBe("/api/v1/reports/revenue-by-project");
    expect(calls[0]!.search.get("preset")).toBe("QUARTER");
  });

  it("answers FORBIDDEN for Member and Viewer", async () => {
    serve({ "GET /api/v1/reports/{slug}": errorEnvelope("FORBIDDEN") });

    const result = await getReportDetail("ACCOUNT_FLOW", reportFilterSchema.parse({}));

    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("getKpiDetail", () => {
  it("picks the KPI from the one BE call of the range, with its sparkline", async () => {
    const calls = serve({ "GET /api/v1/reports/kpis": { body: makeKpisResponse() } });

    const result = await getKpiDetail("MRR", reportFilterSchema.parse({ preset: "YEAR" }));

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, data: { id: "MRR", unit: "USD" } });
    if (result.ok) expect(result.data.sparkline).toHaveLength(12);
  });

  it("returns the null figure of a KPI under a client filter as null, not zero", async () => {
    serve({ "GET /api/v1/reports/kpis": { body: makeKpisResponse() } });

    const result = await getKpiDetail("DSO", reportFilterSchema.parse({}));

    expect(result).toMatchObject({ ok: true, data: { id: "DSO", value: null } });
  });
});
