import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  dismissAlertAction,
  listAlertsAction,
  markAlertsReadAction,
  restoreAlertAction,
  snoozeAlertAction,
} from "./actions";

const key = "DOCUMENT_EXPIRED:doc_propuesta_orinoco";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER", { id: "usr_m" }));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("alert actions", () => {
  it("every role lists, dismisses, snoozes and restores its own alerts", async () => {
    const listed = await listAlertsAction({});
    expect(listed).toMatchObject({ ok: true });
    expect(listed.ok && listed.data.items.map((i) => i.alertKey)).toContain(key);

    expect(await dismissAlertAction({ alertKey: key })).toMatchObject({ ok: true });
    const after = await listAlertsAction({});
    expect(after.ok && after.data.items.map((i) => i.alertKey)).not.toContain(key);

    expect(await snoozeAlertAction({ alertKey: key, days: 7 })).toMatchObject({ ok: true });
    expect(getMockStore().alertDismissals).toHaveLength(1);

    expect(await restoreAlertAction({ alertKey: key })).toMatchObject({
      ok: true,
      data: { active: true },
    });
    expect(getMockStore().alertDismissals).toHaveLength(0);
  });

  it("a Viewer is allowed too (per-user state, DT-71)", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await dismissAlertAction({ alertKey: key })).toMatchObject({ ok: true });
  });

  it("rejects bad keys and out-of-range snoozes with VALIDATION", async () => {
    expect(await dismissAlertAction({ alertKey: "nope" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await snoozeAlertAction({ alertKey: key, days: 0 })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await snoozeAlertAction({ alertKey: key, days: 91 })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("without a session the actions answer UNAUTHENTICATED", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await listAlertsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("'Marcar leídas' marks per user: the unread counter drops, the alert stays listed (A2)", async () => {
    const before = await listAlertsAction({});
    expect(before.ok && before.data.readKeys).not.toContain(key);
    const unread = before.ok ? before.data.unread : 0;

    expect(await markAlertsReadAction({ alertKeys: [key] })).toMatchObject({
      ok: true,
      data: { alertKeys: [key] },
    });
    const after = await listAlertsAction({});
    expect(after.ok && after.data.unread).toBe(unread - 1);
    expect(after.ok && after.data.items.map((i) => i.alertKey)).toContain(key);

    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_o" }));
    const other = await listAlertsAction({});
    expect(other.ok && other.data.readKeys).not.toContain(key);
  });

  it("rejects an empty batch of keys with VALIDATION", async () => {
    expect(await markAlertsReadAction({ alertKeys: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
