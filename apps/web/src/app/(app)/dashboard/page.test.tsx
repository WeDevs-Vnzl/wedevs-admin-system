import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const session = vi.hoisted(() => ({ requireSessionUser: vi.fn() }));
const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireSessionUser: session.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { DashboardViewProps } from "@/features/dashboard/components/dashboard-view";
import { makeDashboardResponse } from "@/features/dashboard/test-fixtures";
import type { SessionUser } from "@/server/auth/types";
import DashboardPage from "./page";

function user(role: SessionUser["role"], name = "Andrés Molina"): SessionUser {
  return {
    id: "usr_test",
    name,
    email: "test.user@example.com",
    imageUrl: null,
    role,
    locale: "es",
    theme: "system",
  };
}

function serve(routes: RouteTable) {
  const mock = mockApi(routes);
  server.api = mock.api;
  return mock.calls;
}

const render = async (search: Record<string, string> = {}) =>
  (await DashboardPage({
    searchParams: Promise.resolve(search),
  })) as ReactElement<DashboardViewProps>;

beforeEach(() => {
  session.requireSessionUser.mockReset();
  server.api = null;
});

describe("/dashboard page", () => {
  it("asks the BE for the period in the URL and renders its dashboard", async () => {
    session.requireSessionUser.mockResolvedValue(user("OWNER"));
    const year = makeDashboardResponse({ period: "year", periodStart: "2026-01-01" });
    const calls = serve({ "GET /api/v1/dashboard": { body: year } });

    const props = (await render({ period: "year" })).props;

    expect(calls.map((call) => call.search.get("period"))).toEqual(["year"]);
    expect(props.period).toBe("year");
    expect(props.dashboard).toEqual(year);
    expect(props.showFinancials).toBe(true);
    expect(props.userName).toBe("Andrés");
  });

  it("falls back to the month period for an unknown period and reads it once", async () => {
    session.requireSessionUser.mockResolvedValue(user("OWNER"));
    const calls = serve({ "GET /api/v1/dashboard": { body: makeDashboardResponse() } });

    const props = (await render({ period: "junk" })).props;

    expect(props.period).toBe("month");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.search.get("period")).toBe("month");
  });

  it("tells the view to hide financial data from Member and Viewer", async () => {
    session.requireSessionUser.mockResolvedValue(user("VIEWER"));
    serve({ "GET /api/v1/dashboard": { body: makeDashboardResponse() } });

    const { showFinancials } = (await render()).props;

    expect(showFinancials).toBe(false);
  });

  it("fails the page when the BE answers an error", async () => {
    session.requireSessionUser.mockResolvedValue(user("OWNER"));
    serve({ "GET /api/v1/dashboard": errorEnvelope("INTERNAL") });

    await expect(render()).rejects.toThrow("INTERNAL");
  });
});
