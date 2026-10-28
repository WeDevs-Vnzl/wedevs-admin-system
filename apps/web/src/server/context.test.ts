import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getPublicServiceContext, getServiceContext, ServiceError } from "./context";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

describe("getServiceContext", () => {
  it("is { db, user, now } over the mock store and the session user", async () => {
    const user = makeSessionUser("ADMIN");
    session.getMockSessionUser.mockResolvedValue(user);
    const before = Date.now();
    const ctx = await getServiceContext();
    expect(Object.keys(ctx).sort()).toEqual(["db", "now", "user"]);
    expect(ctx.db).toBe(getMockStore());
    expect(ctx.user).toBe(user);
    expect(ctx.now).toBeInstanceOf(Date);
    expect(ctx.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("throws UnauthenticatedError when nobody is signed in", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    await expect(getServiceContext()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("getPublicServiceContext", () => {
  it("is { db, user: null, now } and never reads the session", () => {
    const ctx = getPublicServiceContext();
    expect(Object.keys(ctx).sort()).toEqual(["db", "now", "user"]);
    expect(ctx.user).toBeNull();
    expect(ctx.db).toBe(getMockStore());
    expect(ctx.now).toBeInstanceOf(Date);
    expect(session.getMockSessionUser).not.toHaveBeenCalled();
  });
});

describe("ServiceError", () => {
  it("re-exports the domain error services throw", () => {
    const error = new ServiceError("CONFLICT", {
      fieldErrors: { taxId: ["clients.validation.taxIdTaken"] },
    });
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("common.errors.CONFLICT");
    expect(error.fieldErrors).toEqual({ taxId: ["clients.validation.taxIdTaken"] });
    expect(new ServiceError("NOT_FOUND", { message: "clients.errors.gone" }).message).toBe(
      "clients.errors.gone",
    );
  });
});
