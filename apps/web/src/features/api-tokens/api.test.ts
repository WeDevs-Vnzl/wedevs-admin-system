import { describe, expect, it } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import {
  API_TOKEN_MAX_ACTIVE,
  apiTokenMessageKey,
  issueApiToken,
  listApiTokens,
  revokeApiToken,
} from "./api";

const token = {
  id: "tok_1",
  name: "Claude Desktop",
  prefix: "wdc_pat_abcd",
  createdAt: "2026-11-01T12:00:00.000Z",
  expiresAt: "2027-01-30T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

describe("listApiTokens", () => {
  it("returns the caller's tokens", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/me/api-tokens": { body: { items: [token] } } });
    const result = await listApiTokens(api);
    expect(result).toEqual({ ok: true, data: [token] });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
  });
});

describe("issueApiToken", () => {
  it("posts the name and lifetime and returns the secret once", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/me/api-tokens": { status: 201, body: { ...token, secret: "wdc_pat_SECRET" } },
    });
    const result = await issueApiToken(api, { name: "Claude Desktop", expiresInDays: 30 });
    expect(calls[0]?.body).toEqual({ name: "Claude Desktop", expiresInDays: 30 });
    expect(result.ok && result.data.secret).toBe("wdc_pat_SECRET");
  });

  it("maps a lifetime outside 1-365 to a VALIDATION error on expiresInDays", async () => {
    const { api } = mockApi({
      "POST /api/v1/me/api-tokens": errorEnvelope("VALIDATION", {
        fieldErrors: { expiresInDays: ["validation.outOfRange"] },
      }),
    });
    const result = await issueApiToken(api, { name: "x", expiresInDays: 400 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { expiresInDays: ["validation.outOfRange"] } },
    });
  });

  it("maps the 10-active limit to a CONFLICT error", async () => {
    const { api } = mockApi({
      "POST /api/v1/me/api-tokens": errorEnvelope("CONFLICT", {
        message: "settings.apiTokens.errors.limitReached",
      }),
    });
    const result = await issueApiToken(api, { name: "x" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "settings.apiTokens.errors.limitReached" },
    });
  });

  it("turns a network failure into INTERNAL without throwing", async () => {
    const { api } = mockApi({
      "POST /api/v1/me/api-tokens": () => {
        throw new TypeError("offline");
      },
    });
    const result = await issueApiToken(api, { name: "x" });
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });
});

describe("revokeApiToken", () => {
  it("posts to the revoke route of the token", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/me/api-tokens/{id}/revoke": {
        body: { ...token, revokedAt: "2026-11-02T10:00:00.000Z" },
      },
    });
    const result = await revokeApiToken(api, "tok_1");
    expect(calls[0]?.path).toBe("/api/v1/me/api-tokens/tok_1/revoke");
    expect(result.ok && result.data.revokedAt).toBe("2026-11-02T10:00:00.000Z");
  });
});

describe("apiTokenMessageKey", () => {
  const has = (key: string) =>
    key.startsWith("validation.required") || key.startsWith("apiTokens.");

  it("maps the BE keys that live outside the apiTokens namespace", () => {
    expect(apiTokenMessageKey("settings.apiTokens.errors.limitReached", has)).toBe(
      "apiTokens.errors.limitReached",
    );
    expect(apiTokenMessageKey("validation.outOfRange", has)).toBe("apiTokens.errors.outOfRange");
  });

  it("keeps a known key and falls back to the generic error for an unknown one", () => {
    expect(apiTokenMessageKey("validation.required", has)).toBe("validation.required");
    expect(apiTokenMessageKey("validation.unheardOf", has)).toBe("common.errors.VALIDATION");
    expect(apiTokenMessageKey("x.y", has, "common.errors.CONFLICT")).toBe("common.errors.CONFLICT");
  });

  it("exposes the active-token limit", () => {
    expect(API_TOKEN_MAX_ACTIVE).toBe(10);
  });
});
