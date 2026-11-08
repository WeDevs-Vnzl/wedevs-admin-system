import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ api: undefined as unknown, fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({
  getServerApi: async () => {
    if (holder.fail) throw new Error("no token");
    return holder.api;
  },
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { FEATURES_OFF } from "@/lib/features";
import { getFeatures } from "./features";

beforeEach(() => {
  holder.fail = false;
});

describe("getFeatures (GET /api/v1/features, DT-227)", () => {
  it("returns the flags the BE answers", async () => {
    holder.api = mockApi({
      "GET /api/v1/features": { body: { stripe: false, binance: true, bankSync: false } },
    }).api;
    await expect(getFeatures()).resolves.toEqual({ stripe: false, binance: true, bankSync: false });
  });

  it("fails closed on an error answer", async () => {
    holder.api = mockApi({ "GET /api/v1/features": errorEnvelope("INTERNAL") }).api;
    await expect(getFeatures()).resolves.toEqual(FEATURES_OFF);
  });

  it("fails closed when the client cannot be built", async () => {
    holder.fail = true;
    await expect(getFeatures()).resolves.toEqual(FEATURES_OFF);
  });
});
