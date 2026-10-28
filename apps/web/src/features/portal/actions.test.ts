import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  set: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Vitest" }),
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies.has(name) ? { name, value: jar.cookies.get(name) } : undefined,
    set: jar.set,
  }),
}));

import { getMockStore } from "@/mocks/store";
import { UNLOCK_COOKIE_NAMES } from "@/server/portal/unlock-cookie";
import { openSharedDocumentAction, unlockSharedDocumentAction } from "./actions";

const KAIROS = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";
const REVOKED = "jKfayR-yjhR8KWmwa3SY2EYchtiKTV93lqeLnwAfEeQ";
const PRD = "doc_prd_kairos_web";
const CREDENCIALES = "doc_credenciales_kairos";

beforeEach(() => {
  jar.cookies.clear();
  jar.set.mockReset();
  jar.set.mockImplementation((name: string, value: string) => jar.cookies.set(name, value));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("unlockSharedDocumentAction", () => {
  it("unlocks with the right key and remembers it in both scoped cookies", async () => {
    expect(
      await unlockSharedDocumentAction({
        token: KAIROS,
        documentId: CREDENCIALES,
        key: "KAIRO-STAGE-2026",
      }),
    ).toEqual({ ok: true, data: { documentId: CREDENCIALES, unlocked: true } });
    expect(jar.set).toHaveBeenCalledWith(
      UNLOCK_COOKIE_NAMES.page,
      expect.any(String),
      expect.objectContaining({ path: `/s/${KAIROS}`, httpOnly: true, sameSite: "strict" }),
    );
    expect(jar.set).toHaveBeenCalledWith(
      UNLOCK_COOKIE_NAMES.api,
      expect.any(String),
      expect.objectContaining({ path: `/api/s/${KAIROS}` }),
    );
    // The document now opens.
    expect(
      await openSharedDocumentAction({ token: KAIROS, documentId: CREDENCIALES }),
    ).toMatchObject({
      ok: true,
      data: { content: { format: "ENLACE" } },
    });
  });

  it("answers ACCESS_KEY_INVALID for a wrong key and sets no cookie", async () => {
    expect(
      await unlockSharedDocumentAction({
        token: KAIROS,
        documentId: CREDENCIALES,
        key: "WRONG-KEY-0000",
      }),
    ).toMatchObject({ ok: false, error: { code: "ACCESS_KEY_INVALID" } });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("answers VALIDATION for a key shorter than 8 characters", async () => {
    expect(
      await unlockSharedDocumentAction({ token: KAIROS, documentId: CREDENCIALES, key: "short" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { key: expect.any(Array) } },
    });
  });

  it("answers the bare NOT_FOUND on a revoked link", async () => {
    expect(
      await unlockSharedDocumentAction({
        token: REVOKED,
        documentId: "doc_nda_tamanaco",
        key: "WRONG-KEY-0000",
      }),
    ).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" } });
  });
});

describe("openSharedDocumentAction", () => {
  it("returns the content and records a VIEW of that document", async () => {
    const views = () =>
      getMockStore().shareAccessLogs.filter((row) => row.event === "VIEW" && row.documentId === PRD)
        .length;
    const before = views();
    expect(await openSharedDocumentAction({ token: KAIROS, documentId: PRD })).toMatchObject({
      ok: true,
      data: { content: { format: "MARKDOWN" } },
    });
    expect(views()).toBe(before + 1);
  });

  it("refuses a locked document with FORBIDDEN", async () => {
    expect(
      await openSharedDocumentAction({ token: KAIROS, documentId: CREDENCIALES }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
