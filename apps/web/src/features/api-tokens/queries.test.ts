import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { getApiTokens } from "./queries";

const item = {
  id: "tok_1",
  name: "CLI",
  prefix: "wdc_pat_abcd",
  createdAt: "2026-11-01T12:00:00.000Z",
  expiresAt: "2027-01-30T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("getApiTokens", () => {
  it("returns the caller's tokens whatever the role", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/me/api-tokens": { body: { items: [item] } } }).api,
    );
    await expect(getApiTokens()).resolves.toEqual([item]);
  });

  it("sends an unauthenticated caller to sign-in", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/me/api-tokens": errorEnvelope("UNAUTHENTICATED") }).api,
    );
    await expect(getApiTokens()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("throws on any other failure so the error boundary shows it", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/me/api-tokens": errorEnvelope("INTERNAL") }).api,
    );
    await expect(getApiTokens()).rejects.toThrow("INTERNAL");
  });
});
