import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => nav);

import { ServiceError } from "@/server/errors";
import { notFoundWhenRefused, orNullWhenMissing } from "./refusal";

describe("notFoundWhenRefused", () => {
  it("answers the not-found page when the BE refuses the role (FORBIDDEN) or the id is unknown", async () => {
    for (const code of ["FORBIDDEN", "NOT_FOUND"] as const) {
      await expect(
        notFoundWhenRefused(() => Promise.reject(new ServiceError(code))),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(nav.notFound).toHaveBeenCalledTimes(2);
  });

  it("rethrows any other failure and passes a result through", async () => {
    await expect(notFoundWhenRefused(async () => 7)).resolves.toBe(7);
    await expect(
      notFoundWhenRefused(() => Promise.reject(new ServiceError("VALIDATION"))),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("orNullWhenMissing", () => {
  it("is null for NOT_FOUND and FORBIDDEN, and rethrows the rest", async () => {
    await expect(
      orNullWhenMissing(() => Promise.reject(new ServiceError("NOT_FOUND"))),
    ).resolves.toBeNull();
    await expect(
      orNullWhenMissing(() => Promise.reject(new ServiceError("FORBIDDEN"))),
    ).resolves.toBeNull();
    await expect(
      orNullWhenMissing(() => Promise.reject(new ServiceError("CONFLICT"))),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
