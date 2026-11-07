import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("@/server/auth/session", () => session);

import { errorEnvelope, mockApi, type RouteResponse } from "@/lib/api/testing";
import type { SessionUser } from "@/server/auth/types";
import {
  activityFilterFromSearchParams,
  canReadActivity,
  getActivityPage,
  getEntityActivity,
} from "./queries";

const TS = "2026-10-09T15:00:00.000Z";

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    actor: { type: "USER", id: "usr_ana", name: "Ana Torres", imageUrl: null },
    action: "UPDATE",
    entityType: "CLIENT",
    entityId: "cli_kairos",
    entityLabel: "Kairos Studio",
    changes: null,
    metadata: null,
    ip: "192.0.2.•••",
    userAgent: null,
    createdAt: TS,
    ...overrides,
  };
}

function page(items: unknown[], total = items.length) {
  return { items, page: 1, pageCount: 1, pageSize: 25, total };
}

function user(role: SessionUser["role"]): SessionUser {
  return {
    id: "usr_ana",
    name: "Ana Torres",
    email: "ana@example.test",
    imageUrl: null,
    role,
    locale: "es",
    theme: "system",
  };
}

/**
 * HTTP double of the activity endpoints. `pageSize=100` is the actors lookup; anything else is the feed or
 * a timeline. `forbidden` answers the BE refusal of a role without `read` on activity.
 */
function activityApi(options: { forbidden?: boolean; feed?: unknown[]; recent?: unknown[] } = {}) {
  const forbidden = (): RouteResponse => errorEnvelope("FORBIDDEN");
  const mocked = mockApi({
    "GET /api/v1/activity": (call) => {
      if (options.forbidden) return forbidden();
      const isActors = call.search.get("pageSize") === "100";
      return { body: page(isActors ? (options.recent ?? []) : (options.feed ?? [])) };
    },
    "GET /api/v1/activity/overview": () =>
      options.forbidden ? forbidden() : { body: { total: 148, today: 12, users: 90 } },
  });
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  session.getSessionUser.mockReset();
});

describe("getActivityPage", () => {
  it("reads the feed, the overview figures and the user options from the BE", async () => {
    session.getSessionUser.mockResolvedValue(user("OWNER"));
    const feed = [row("act_1"), row("act_2")];
    const recent = [
      row("act_1"),
      row("act_3", { actor: { type: "USER", id: "usr_luis", name: "Luis Pérez", imageUrl: null } }),
    ];
    const { calls } = activityApi({ feed, recent });

    const data = await getActivityPage({ actorType: "USER" });

    expect(data).not.toBeNull();
    expect(data!.feed.items.map((item) => item.id)).toEqual(["act_1", "act_2"]);
    expect(data!.stats).toEqual({ total: 148, today: 12, users: 90 });
    expect(data!.actors).toEqual([
      { id: "usr_ana", name: "Ana Torres" },
      { id: "usr_luis", name: "Luis Pérez" },
    ]);
    const feedCall = calls.find(
      (call) => call.path === "/api/v1/activity" && call.search.get("pageSize") === "25",
    );
    expect(feedCall?.search.getAll("actorType")).toEqual(["USER"]);
    expect(feedCall?.search.get("page")).toBe("1");
  });

  it("asks the overview with the table filter and no paging, so the figures match the rows", async () => {
    session.getSessionUser.mockResolvedValue(user("ADMIN"));
    const { calls } = activityApi();
    await getActivityPage({ action: ["UPDATE"], from: "2026-10-01", to: "2026-10-09" });
    const overview = calls.find((call) => call.path === "/api/v1/activity/overview");
    expect(overview?.search.getAll("action")).toEqual(["UPDATE"]);
    expect(overview?.search.get("from")).toBe("2026-10-01");
    expect(overview?.search.get("to")).toBe("2026-10-09");
    expect(overview?.search.has("page")).toBe(false);
    expect(overview?.search.has("pageSize")).toBe(false);
  });

  it("returns null when the BE refuses the read (FORBIDDEN for Member and Viewer)", async () => {
    session.getSessionUser.mockResolvedValue(user("MEMBER"));
    activityApi({ forbidden: true });
    expect(await getActivityPage({})).toBeNull();
  });

  it("throws on any other failure, so the error boundary shows it", async () => {
    session.getSessionUser.mockResolvedValue(user("OWNER"));
    const mocked = mockApi({
      "GET /api/v1/activity": errorEnvelope("INTERNAL"),
      "GET /api/v1/activity/overview": errorEnvelope("INTERNAL"),
    });
    server.getServerApi.mockResolvedValue(mocked.api);
    await expect(getActivityPage({})).rejects.toThrow("activity: feed failed with 500");
  });
});

describe("canReadActivity and getEntityActivity", () => {
  it("grants the read to Owner and Admin only, and nobody signed out", async () => {
    session.getSessionUser.mockResolvedValue(user("ADMIN"));
    expect(await canReadActivity()).toBe(true);
    session.getSessionUser.mockResolvedValue(user("MEMBER"));
    expect(await canReadActivity()).toBe(false);
    session.getSessionUser.mockResolvedValue(null);
    expect(await canReadActivity()).toBe(false);
  });

  it("returns the timeline of one record filtered by entityType and entityId", async () => {
    const timeline = [row("act_9")];
    const { calls } = activityApi({ feed: timeline });
    const result = await getEntityActivity({ type: "CLIENT", id: "cli_kairos" });
    expect(result?.items.map((item) => item.id)).toEqual(["act_9"]);
    expect(calls[0]?.search.getAll("entityType")).toEqual(["CLIENT"]);
    expect(calls[0]?.search.get("entityId")).toBe("cli_kairos");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
  });

  it("returns null without access (the tab is not shown)", async () => {
    activityApi({ forbidden: true });
    expect(await getEntityActivity({ type: "CLIENT", id: "cli_kairos" })).toBeNull();
  });
});

describe("activityFilterFromSearchParams", () => {
  it("keeps only the filter keys of the URL", () => {
    expect(
      activityFilterFromSearchParams({
        actorType: "SYSTEM",
        action: ["UPDATE", "LINK"],
        page: "9",
        junk: "x",
      }),
    ).toEqual({ actorType: "SYSTEM", action: ["UPDATE", "LINK"] });
  });

  it("falls back to the unfiltered log when the URL holds an invalid filter", () => {
    expect(activityFilterFromSearchParams({ from: "2026-10-09", to: "2026-10-01" })).toEqual({});
    expect(activityFilterFromSearchParams({ actorType: "ROOT" })).toEqual({});
  });
});
