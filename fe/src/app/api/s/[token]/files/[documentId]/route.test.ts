import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Vitest" }),
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies.has(name) ? { name, value: jar.cookies.get(name) } : undefined,
    set: vi.fn(),
  }),
}));

import { getMockStore } from "@/mocks/store";
import { portalSecret } from "@/server/portal/request-meta";
import { UNLOCK_COOKIE_NAMES, signUnlockCookie } from "@/server/portal/unlock-cookie";
import { GET } from "./route";

const KAIROS = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";
const REVOKED = "jKfayR-yjhR8KWmwa3SY2EYchtiKTV93lqeLnwAfEeQ";
const CONTRATO = "doc_contrato_kairos";
const PRD = "doc_prd_kairos_web";
const CREDENCIALES = "doc_credenciales_kairos";

function get(token: string, documentId: string, query = "") {
  return GET(new Request(`http://localhost/api/s/${token}/files/${documentId}${query}`), {
    params: Promise.resolve({ token, documentId }),
  });
}

function expectPortalHeaders(response: Response) {
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

const downloads = () =>
  getMockStore().shareAccessLogs.filter((row) => row.event === "DOWNLOAD").length;

beforeEach(() => {
  jar.cookies.clear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("GET /api/s/[token]/files/[documentId]", () => {
  it("serves a shared PDF inline for the viewer with the portal headers and logs nothing", async () => {
    const before = downloads();
    const response = await get(KAIROS, CONTRATO);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^inline; filename="contrato-kairos-firmado\.pdf"/,
    );
    expectPortalHeaders(response);
    expect(new TextDecoder("latin1").decode(await response.arrayBuffer())).toMatch(/^%PDF-1\.4/);
    expect(downloads()).toBe(before);
  });

  it("downloads as an attachment and logs DOWNLOAD", async () => {
    const before = downloads();
    const response = await get(KAIROS, CONTRATO, "?download=1");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="contrato-kairos-firmado\.pdf"/,
    );
    expect(downloads()).toBe(before + 1);
  });

  it("downloads markdown as a sandboxed .md", async () => {
    const response = await get(KAIROS, PRD, "?download=1");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("content-disposition")).toMatch(/filename="DOC-\d{4}-v\d+\.md"/);
  });

  it("refuses a download when the link does not allow it", async () => {
    getMockStore().shareLinks.find((link) => link.token === KAIROS)!.allowDownload = false;
    expect((await get(KAIROS, CONTRATO, "?download=1")).status).toBe(403);
  });

  it("refuses a locked document with 403 until the unlock cookie of this link lists it", async () => {
    const locked = await get(KAIROS, CREDENCIALES);
    expect(locked.status).toBe(403);
    expectPortalHeaders(locked);
    jar.cookies.set(
      UNLOCK_COOKIE_NAMES.api,
      signUnlockCookie(
        { token: KAIROS, documentIds: [CREDENCIALES], now: new Date() },
        portalSecret("SHARE_UNLOCK_SECRET"),
      ),
    );
    const open = await get(KAIROS, CREDENCIALES);
    expect(open.status).toBe(307);
    expect(open.headers.get("location")).toBe("https://vault.example.com/shared/kairos-staging");
  });

  it("answers 503 with the portal headers when a portal secret is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHARE_IP_SALT", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await get(KAIROS, CONTRATO);
    vi.unstubAllEnvs();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expectPortalHeaders(response);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("SHARE_IP_SALT is not configured"));
    error.mockRestore();
  });

  it("answers a bare 404 for a revoked link, a malformed token and a document outside the link", async () => {
    for (const response of [
      await get(REVOKED, "doc_nda_tamanaco"),
      await get("not-a-token", CONTRATO),
      await get(KAIROS, "doc_nda_tamanaco"),
      await get(KAIROS, "../etc/passwd"),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expectPortalHeaders(response);
    }
  });
});
