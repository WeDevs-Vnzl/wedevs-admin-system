import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { reportFilterSchema } from "@/lib/validators/reports";
import { getKpiCards } from "./queries";
import { makeKpisResponse } from "./test-fixtures";

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
