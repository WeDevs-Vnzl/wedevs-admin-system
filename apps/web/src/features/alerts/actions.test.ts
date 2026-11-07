import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  dismissAlertAction,
  listAlertsAction,
  markAlertsReadAction,
  restoreAlertAction,
  snoozeAlertAction,
} from "./actions";

const key = "DOCUMENT_EXPIRED:doc_propuesta_orinoco";
const rateKey = "MISSING_RATE:VES:2026-10-09";

const inbox = {
  total: 2,
  unread: 1,
  byType: { DOCUMENT_EXPIRED: 1, MISSING_RATE: 1 },
  readKeys: [key],
  items: [
    {
      alertKey: key,
      type: "DOCUMENT_EXPIRED",
      entity: { type: "DOCUMENT", id: "doc_propuesta_orinoco", label: "Propuesta Orinoco" },
      date: "2026-10-01",
      days: -8,
      amount: null,
      context: "Propuesta",
    },
    {
      alertKey: rateKey,
      type: "MISSING_RATE",
      entity: null,
      date: "2026-10-09",
      days: 0,
      amount: null,
      context: null,
    },
  ],
} as const;

const dismissal = { alertKey: key, dismissedUntil: null, active: false } as const;

function serve(routes: RouteTable) {
  const api = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
  mocks.auth.mockReset();
  mocks.getServerApi.mockReset();
  mocks.auth.mockResolvedValue({ userId: "user_clerk", getToken: async () => "clerk-token" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listAlertsAction (GET /api/v1/alerts)", () => {
  it("lists the caller's live alerts with the unread counter and read keys", async () => {
    const api = serve({ "GET /api/v1/alerts": { body: inbox } });
    expect(await listAlertsAction({})).toEqual({ ok: true, data: inbox });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.search.getAll("types")).toEqual([]);
    expect(api.calls[0]?.search.get("limit")).toBeNull();
  });

  it("sends the type narrowing and the limit of a module overview or the bell", async () => {
    const api = serve({ "GET /api/v1/alerts": { body: inbox } });
    await listAlertsAction({ types: ["MISSING_RATE", "DOCUMENT_EXPIRED"], limit: 20 });
    expect(api.calls[0]?.search.getAll("types")).toEqual(["MISSING_RATE", "DOCUMENT_EXPIRED"]);
    expect(api.calls[0]?.search.get("limit")).toBe("20");
  });

  it("maps a 401 to UNAUTHENTICATED with the sign-in redirect", async () => {
    serve({ "GET /api/v1/alerts": errorEnvelope("UNAUTHENTICATED") });
    expect(await listAlertsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", redirectTo: "/sign-in" },
    });
  });
});

describe("dismiss, snooze and restore (POST /api/v1/alerts/{key}/…)", () => {
  it("dismisses for good with no days in the body, URL-encoding the key", async () => {
    const api = serve({ "POST /api/v1/alerts/{key}/dismiss": { body: dismissal } });
    expect(await dismissAlertAction({ alertKey: key })).toEqual({ ok: true, data: dismissal });
    expect(api.calls[0]?.path).toBe(`/api/v1/alerts/${encodeURIComponent(key)}/dismiss`);
    expect(api.calls[0]?.body ?? {}).toEqual({});
  });

  it("snoozes for 7 days through the dismiss endpoint and encodes the colons of a rate key", async () => {
    const snoozed = { alertKey: rateKey, dismissedUntil: "2026-10-16T12:00:00.000Z", active: false };
    const api = serve({ "POST /api/v1/alerts/{key}/dismiss": { body: snoozed } });
    expect(await snoozeAlertAction({ alertKey: rateKey, days: 7 })).toEqual({
      ok: true,
      data: snoozed,
    });
    expect(api.calls[0]?.path).toBe("/api/v1/alerts/MISSING_RATE%3AVES%3A2026-10-09/dismiss");
    expect(api.calls[0]?.body).toEqual({ days: 7 });
  });

  it("restores a dismissed or snoozed alert", async () => {
    const restored = { alertKey: key, dismissedUntil: null, active: true };
    const api = serve({ "POST /api/v1/alerts/{key}/restore": { body: restored } });
    expect(await restoreAlertAction({ alertKey: key })).toEqual({ ok: true, data: restored });
    expect(api.calls[0]?.path).toBe(`/api/v1/alerts/${encodeURIComponent(key)}/restore`);
  });

  it("maps NOT_FOUND for an alert the caller cannot see, so the list can drop it", async () => {
    serve({ "POST /api/v1/alerts/{key}/dismiss": errorEnvelope("NOT_FOUND") });
    expect(await dismissAlertAction({ alertKey: key })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes the layout (the bell counter) after a successful change", async () => {
    serve({
      "POST /api/v1/alerts/{key}/dismiss": { body: dismissal },
      "POST /api/v1/alerts/{key}/restore": { body: { ...dismissal, active: true } },
    });
    await dismissAlertAction({ alertKey: key });
    await restoreAlertAction({ alertKey: key });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledTimes(2);
  });
});

describe("markAlertsReadAction (POST /api/v1/alerts/read)", () => {
  it("marks the batch read; the alerts stay listed", async () => {
    const api = serve({ "POST /api/v1/alerts/read": { body: { alertKeys: [key] } } });
    expect(await markAlertsReadAction({ alertKeys: [key] })).toEqual({
      ok: true,
      data: { alertKeys: [key] },
    });
    expect(api.calls[0]?.body).toEqual({ alertKeys: [key] });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("maps a VALIDATION envelope with its field errors and does not refresh the layout", async () => {
    serve({
      "POST /api/v1/alerts/read": errorEnvelope("VALIDATION", {
        fieldErrors: { alertKeys: ["validation.tooMany"] },
      }),
    });
    expect(await markAlertsReadAction({ alertKeys: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { alertKeys: ["validation.tooMany"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
