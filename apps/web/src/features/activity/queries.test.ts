import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  activityFilterFromSearchParams,
  canReadActivity,
  getActivityPage,
  getEntityActivity,
} from "./queries";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

describe("getActivityPage", () => {
  it("returns the filtered feed, the stat cards and the user options for Owner", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const data = await getActivityPage({ actorType: "USER" });
    expect(data).not.toBeNull();
    expect(data!.feed.items.every((row) => row.actor.type === "USER")).toBe(true);
    expect(data!.stats.total).toBe(data!.feed.total);
    expect(data!.stats.users).toBe(data!.feed.total);
    expect(data!.stats.today).toBeGreaterThanOrEqual(0);
    expect(data!.actors.length).toBeGreaterThan(0);
    expect(data!.actors.every((actor) => actor.name.length > 0)).toBe(true);
  });

  it("returns null for Member and Viewer (the page answers notFound)", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
      expect(await getActivityPage({})).toBeNull();
    }
  });
});

describe("canReadActivity and getEntityActivity", () => {
  it("grants the read to Owner and Admin only", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    expect(await canReadActivity()).toBe(true);
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    expect(await canReadActivity()).toBe(false);
  });

  it("returns the timeline of one record, and null without access", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const id = getMockStore().activity.find((row) => row.entityType === "CLIENT")!.entityId;
    const timeline = await getEntityActivity({ type: "CLIENT", id });
    expect(timeline!.items.length).toBeGreaterThan(0);
    expect(timeline!.items.every((row) => row.entityId === id)).toBe(true);
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await getEntityActivity({ type: "CLIENT", id })).toBeNull();
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
