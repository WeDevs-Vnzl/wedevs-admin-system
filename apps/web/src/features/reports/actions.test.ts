import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { reportFilterSchema } from "@/lib/validators/reports";
import { getKpisAction } from "./actions";
import { makeKpisResponse } from "./test-fixtures";

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

beforeEach(() => {
  server.api = null;
});

describe("getKpisAction", () => {
  it("reloads the KPIs of a new range through the BE and returns the response", async () => {
    const body = makeKpisResponse("2026-09");
    const calls = serve({
      "GET /api/v1/reports/kpis": { body },
    });

    const result = await getKpisAction({
      filter: reportFilterSchema.parse({ preset: "PREVIOUS_MONTH" }),
    });

    expect(result).toEqual({ ok: true, data: body });
    expect(calls[0]!.search.get("preset")).toBe("PREVIOUS_MONTH");
    expect(calls[0]!.search.has("from")).toBe(false);
  });

  it("returns the BE error envelope as the action error", async () => {
    serve({ "GET /api/v1/reports/kpis": errorEnvelope("VALIDATION") });

    const result = await getKpisAction({ filter: reportFilterSchema.parse({}) });

    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
});
