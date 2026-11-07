import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { makeDashboardResponse } from "./test-fixtures";
import { getDashboardForPeriod } from "./queries";

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

beforeEach(() => {
  server.api = null;
});

describe("getDashboardForPeriod", () => {
  it.each(["month", "quarter", "year"] as const)(
    "asks the BE once for the %s period and returns its body",
    async (period) => {
      const body = makeDashboardResponse({ period });
      const calls = serve({ "GET /api/v1/dashboard": { body } });

      const result = await getDashboardForPeriod(period);

      expect(result).toEqual({ ok: true, data: body });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe("/api/v1/dashboard");
      expect(calls[0]!.search.get("period")).toBe(period);
    },
  );

  it("maps an error envelope to the UI error without aggregating anything", async () => {
    const calls = serve({
      "GET /api/v1/dashboard": errorEnvelope("INTERNAL", { correlationId: "corr-1" }),
    });

    const result = await getDashboardForPeriod("year");

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL", correlationId: "corr-1" },
    });
    expect(calls).toHaveLength(1);
  });
});
