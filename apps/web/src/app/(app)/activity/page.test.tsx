import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
const intl = vi.hoisted(() => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("next-intl/server", () => intl);
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND_TEST");
  }),
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import ActivityPage from "./page";

const params = (search: Record<string, string | string[]> = {}) => ({
  searchParams: Promise.resolve(search),
});

const emptyPage = { items: [], page: 1, pageCount: 1, pageSize: 25, total: 0 };

/** The BE answers FORBIDDEN to a role without `read` on activity; Owner and Admin get the log. */
function activityApi(allowed: boolean) {
  const mocked = mockApi({
    "GET /api/v1/activity": allowed ? { body: emptyPage } : errorEnvelope("FORBIDDEN"),
    "GET /api/v1/activity/overview": allowed
      ? { body: { total: 0, today: 0, users: 0 } }
      : errorEnvelope("FORBIDDEN"),
  });
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
});

describe("/activity page", () => {
  it.each(["MEMBER", "VIEWER"] as const)(
    "answers the in-shell notFound() when the BE refuses the read (%s)",
    async () => {
      activityApi(false);
      await expect(ActivityPage(params())).rejects.toThrow("NOT_FOUND_TEST");
    },
  );

  it("renders for Owner and Admin, forwarding the filter from the URL to the BE", async () => {
    const { calls } = activityApi(true);
    const element = await ActivityPage(params({ actorType: "SYSTEM", junk: "x" }));
    expect(element).toBeTruthy();
    // The feed is the page-size-25 read; the actors lookup asks for 100.
    const feed = calls.find(
      (call) => call.path === "/api/v1/activity" && call.search.get("pageSize") === "25",
    );
    expect(feed?.search.getAll("actorType")).toEqual(["SYSTEM"]);
    expect(feed?.search.has("junk")).toBe(false);
  });
});
