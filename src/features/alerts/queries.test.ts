import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { makeSessionUser } from "@/mocks/test-helpers";
import { markAlertsRead } from "@/mocks/services/alerts";
import { getMockStore } from "@/mocks/store";
import { createMockContext } from "@/mocks/ctx";
import { countUnreadAlerts, listAlerts } from "./queries";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listAlerts query", () => {
  it("applies the input defaults and reads as the session user", async () => {
    const summary = await listAlerts();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.items.length).toBeLessThanOrEqual(50);
  });

  it("narrows by type", async () => {
    const summary = await listAlerts({ types: ["DOCUMENT_EXPIRED"] });
    expect(summary.items.every((item) => item.type === "DOCUMENT_EXPIRED")).toBe(true);
  });

  it("throws UNAUTHENTICATED without a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    await expect(listAlerts()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("countUnreadAlerts is the bell counter: active alerts minus the ones the user read", async () => {
    const summary = await listAlerts();
    expect(await countUnreadAlerts()).toBe(summary.total);

    const user = makeSessionUser("OWNER");
    const first = summary.items[0]!.alertKey;
    await markAlertsRead(createMockContext({ user, now: new Date(), db: getMockStore() }), {
      alertKeys: [first],
    });
    expect(await countUnreadAlerts()).toBe(summary.total - 1);
  });
});
