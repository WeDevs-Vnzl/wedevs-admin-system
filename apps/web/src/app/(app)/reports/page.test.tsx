import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { makeKpisResponse } from "@/features/reports/test-fixtures";
import ReportsPage from "./page";

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

const props = (search: Record<string, string> = {}) => ({ searchParams: Promise.resolve(search) });

beforeEach(() => {
  server.api = null;
});

describe("/reports page", () => {
  it("reads the range from the URL and asks the BE for the KPIs of that range", async () => {
    const calls = serve({ "GET /api/v1/reports/kpis": { body: makeKpisResponse() } });

    const element = await ReportsPage(
      props({ preset: "CUSTOM", from: "2026-01-01", to: "2026-03-31" }),
    );

    expect(element).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.search.get("preset")).toBe("CUSTOM");
    expect(calls[0]!.search.get("from")).toBe("2026-01-01");
    expect(calls[0]!.search.get("to")).toBe("2026-03-31");
  });

  it("shows the forbidden state, not the data, when the BE answers FORBIDDEN (Member and Viewer)", async () => {
    serve({ "GET /api/v1/reports/kpis": errorEnvelope("FORBIDDEN") });

    render(await ReportsPage(props()));

    expect(screen.getByText("forbidden")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "page.kpisTitle" })).not.toBeInTheDocument();
  });

  it("fails the page for any other BE error", async () => {
    serve({ "GET /api/v1/reports/kpis": errorEnvelope("INTERNAL") });

    await expect(ReportsPage(props())).rejects.toThrow("INTERNAL");
  });
});
