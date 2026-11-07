import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { ServiceError } from "@/lib/service-error";
import { notFoundWhenRefused, orNullWhenMissing } from "./refusal";

describe("notFoundWhenRefused", () => {
  it("returns the read when the BE answers", async () => {
    await expect(notFoundWhenRefused(async () => "page")).resolves.toBe("page");
  });

  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("answers the not-found page on %s", async (code) => {
    await expect(
      notFoundWhenRefused(async () => {
        throw new ServiceError(code);
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets any other failure reach the route's error boundary", async () => {
    await expect(
      notFoundWhenRefused(async () => {
        throw new ServiceError("INTERNAL");
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("orNullWhenMissing", () => {
  it("turns NOT_FOUND into null and rethrows the rest", async () => {
    await expect(
      orNullWhenMissing(async () => {
        throw new ServiceError("NOT_FOUND");
      }),
    ).resolves.toBeNull();
    await expect(
      orNullWhenMissing(async () => {
        throw new ServiceError("FORBIDDEN");
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
